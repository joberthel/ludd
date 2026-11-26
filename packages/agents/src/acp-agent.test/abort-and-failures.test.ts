import fs from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { acpAgent } from '../acp-agent.js'
import { FAKE_ACP_SERVER, isProcessAlive, makeTurnInput, readPidFile } from './helpers.js'

async function waitForFile(filePath: string, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!fs.existsSync(filePath)) {
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for file: ${filePath}`)
    }
    await new Promise(resolve => setTimeout(resolve, 15))
  }
}

async function waitForPidDead(pid: number, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (isProcessAlive(pid)) {
    if (Date.now() > deadline) {
      throw new Error(`Process ${pid} did not exit within ${timeoutMs}ms`)
    }
    await new Promise(resolve => setTimeout(resolve, 20))
  }
}

describe('acpAgent cancellation, cleanup, and failure modes', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'ludd-acp-abort-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('rejects immediately on pre-aborted AbortSignal without spawning', async () => {
    const pidFile = path.join(dir, 'never.pid')
    const agent = acpAgent({
      command: process.execPath,
      args: [FAKE_ACP_SERVER],
      env: { FAKE_ACP_PID_FILE: pidFile },
    })

    const controller = new AbortController()
    controller.abort(new Error('pre-aborted-reason'))

    await expect(agent.executeTurn(makeTurnInput(dir, { signal: controller.signal }))).rejects.toThrow(
      'pre-aborted-reason',
    )
    expect(fs.existsSync(pidFile)).toBe(false)
  })

  it('sends session/cancel on mid-turn abort and exits cleanly', async () => {
    const pidFile = path.join(dir, 'clean-cancel.pid')
    const promptReadyFile = path.join(dir, 'clean-ready.txt')
    const cancelFile = path.join(dir, 'cancelled.txt')
    const controller = new AbortController()

    const agent = acpAgent({
      command: process.execPath,
      args: [FAKE_ACP_SERVER],
      shutdownTimeoutMs: 1000,
      env: {
        FAKE_ACP_SCENARIO: 'cancel-clean',
        FAKE_ACP_PID_FILE: pidFile,
        FAKE_ACP_PROMPT_READY_FILE: promptReadyFile,
        FAKE_ACP_CANCEL_FILE: cancelFile,
      },
    })

    const turnPromise = agent.executeTurn(makeTurnInput(dir, { signal: controller.signal }))
    await waitForFile(pidFile)
    const childPid = readPidFile(pidFile)

    await waitForFile(promptReadyFile)
    controller.abort(new Error('user-cancelled'))

    await expect(turnPromise).rejects.toThrow('user-cancelled')
    expect(fs.readFileSync(cancelFile, 'utf8')).toBe('fake-session-1')
    await waitForPidDead(childPid)
  })

  it('forces process tree termination after shutdownTimeoutMs when agent ignores session/cancel', async () => {
    const pidFile = path.join(dir, 'hang-cancel.pid')
    const promptReadyFile = path.join(dir, 'hang-ready.txt')
    const controller = new AbortController()

    const agent = acpAgent({
      command: process.execPath,
      args: [FAKE_ACP_SERVER],
      shutdownTimeoutMs: 120,
      env: {
        FAKE_ACP_SCENARIO: 'cancel-hang',
        FAKE_ACP_PID_FILE: pidFile,
        FAKE_ACP_PROMPT_READY_FILE: promptReadyFile,
        FAKE_ACP_IGNORE_SIGTERM: '1',
      },
    })

    const turnPromise = agent.executeTurn(makeTurnInput(dir, { signal: controller.signal }))
    await waitForFile(pidFile)
    const childPid = readPidFile(pidFile)

    await waitForFile(promptReadyFile)
    controller.abort(new Error('hung-cancel-aborted'))

    await expect(turnPromise).rejects.toThrow('hung-cancel-aborted')
    await waitForPidDead(childPid)
  })

  it('handles abort during handshake before session creation', async () => {
    const readyFile = path.join(dir, 'handshake-ready.txt')
    const controller = new AbortController()
    const agent = acpAgent({
      command: process.execPath,
      args: [
        '-e',
        'require("node:fs").writeFileSync(process.env.READY_FILE, "1"); setInterval(() => {}, 1000)',
      ],
      env: { READY_FILE: readyFile },
      shutdownTimeoutMs: 100,
    })

    const turnPromise = agent.executeTurn(makeTurnInput(dir, { signal: controller.signal }))
    await waitForFile(readyFile)
    controller.abort(new Error('early-abort'))

    await expect(turnPromise).rejects.toThrow('early-abort')
  })

  it('forces cleanup if subprocess refuses to exit after prompt completion', async () => {
    const pidFile = path.join(dir, 'hang-after.pid')
    const agent = acpAgent<string>({
      command: process.execPath,
      args: [FAKE_ACP_SERVER],
      shutdownTimeoutMs: 100,
      env: {
        FAKE_ACP_SCENARIO: 'hang-after-prompt',
        FAKE_ACP_PID_FILE: pidFile,
      },
    })

    const res = await agent.executeTurn(makeTurnInput(dir))
    expect(res.output).toBe('Hello world!')
    await waitForPidDead(readPidFile(pidFile))
  })

  it('rejects with descriptive error on subprocess crash, spawn failure, and protocol error', async () => {
    const crashAgent = acpAgent({
      command: process.execPath,
      args: [FAKE_ACP_SERVER],
      env: { FAKE_ACP_SCENARIO: 'crash' },
    })
    await expect(crashAgent.executeTurn(makeTurnInput(dir))).rejects.toThrow(
      /exited unexpectedly with code 42.*fatal fake crash/,
    )

    const missingAgent = acpAgent({
      command: path.join(dir, 'does-not-exist-acp-cli'),
    })
    await expect(missingAgent.executeTurn(makeTurnInput(dir))).rejects.toThrow(
      /Failed to spawn ACP subprocess/,
    )

    const initErrAgent = acpAgent({
      command: process.execPath,
      args: [FAKE_ACP_SERVER],
      env: { FAKE_ACP_SCENARIO: 'init-error' },
    })
    await expect(initErrAgent.executeTurn(makeTurnInput(dir))).rejects.toThrow(/init boom/)

    const signalKillAgent = acpAgent({
      command: process.execPath,
      args: [
        '-e',
        'process.stderr.write("a".repeat(3000)); setTimeout(() => { process.stderr.write("b".repeat(3000)); }, 25); setTimeout(() => { process.stderr.write("c".repeat(100)); process.kill(process.pid, "SIGKILL"); }, 60)',
      ],
    })
    await expect(signalKillAgent.executeTurn(makeTurnInput(dir))).rejects.toThrow(/signal SIGKILL/)

    const prematureExitAgent = acpAgent({
      command: process.execPath,
      args: ['-e', 'process.exit(0)'],
    })
    await expect(prematureExitAgent.executeTurn(makeTurnInput(dir))).rejects.toThrow(
      /exited unexpectedly with code 0/,
    )
  })
})
