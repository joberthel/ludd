import type { ControlClient } from '../../types/ipc.js'
import type { RunStateSnapshot } from '../../types/state.js'
import fs from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { humanReviewGuardrail } from '@ludd/guardrails'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createControlClient } from '../../ipc/control-client.js'
import { readLedgerEvents } from '../../persistence/ledger-writer.js'
import { RUNNER_PID_FILE } from '../../persistence/pid-lock.js'
import { readRunState } from '../../persistence/state-store.js'
import { runHarness } from '../run-harness.js'

let tempDir: string

beforeEach(async () => {
  const baseDir = process.platform === 'win32'
    ? os.tmpdir()
    : '/tmp'
  tempDir = await mkdtemp(path.join(baseDir, 'ludd-abort-td-'))
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

async function waitForRunState(
  runDir: string,
  predicate: (state: RunStateSnapshot) => boolean,
): Promise<ControlClient> {
  for (let i = 0; i < 50; i++) {
    try {
      const client = await createControlClient(runDir)
      const state = await client.status()
      if (predicate(state)) {
        return client
      }
      await client.close()
    }
    catch {
      // Socket not ready yet
    }
    await new Promise(r => setTimeout(r, 50))
  }
  throw new Error('Timeout waiting for target run state in control server')
}

function createMockEnv(id: string, workingDir: string, teardown = vi.fn().mockResolvedValue(undefined)) {
  return {
    env: {
      __kind: 'environment' as const,
      id,
      type: 'host',
      workingDir,
      exec: vi.fn(),
      ping: vi.fn().mockResolvedValue(true),
      teardown,
    },
    teardown,
  }
}

function makeGateConfig(name: string, environment: any, prompt: string) {
  return {
    name,
    steps: [
      {
        id: 'gate-step',
        environment,
        beforeStep: [
          humanReviewGuardrail({ prompt }),
        ],
        run: async () => 'ok',
      },
    ],
  }
}

describe('run.abort RPC method while waiting at gate (AC 6.6.1)', () => {
  it('aborts waiting gate immediately, tears down environments, records status failed', async () => {
    const runId = 'abort-at-gate'
    const runDir = path.join(tempDir, '.harness', 'runs', runId)
    const { env: customEnv, teardown: teardownMock } = createMockEnv('custom-box', tempDir)

    const runPromise = runHarness(
      makeGateConfig('gate-abort-pipeline', customEnv, 'Approve before continuing:'),
      { runId, workspaceDir: tempDir },
    )

    const client = await waitForRunState(runDir, s => s.status === 'waiting_for_gate' && Boolean(s.activeGate))
    const abortResult = await client.abort({ reason: 'User canceled at gate', teardown: true })
    expect(abortResult.ok).toBe(true)
    await client.close()

    const result = await runPromise
    expect(result.status).toBe('failed')
    expect(teardownMock).toHaveBeenCalledTimes(1)

    const state = readRunState(runDir)
    expect(state.status).toBe('failed')
    expect(state.activeGate).toBeNull()

    const events = readLedgerEvents(runDir)
    const failedEvent = events.find(e => e.eventType === 'run.failed')
    expect(failedEvent?.payload.error).toBe('User canceled at gate')
    expect(events.some(e => e.eventType === 'run.teardown')).toBe(true)
    expect(fs.existsSync(path.join(runDir, RUNNER_PID_FILE))).toBe(false)
  })
})

describe('run.abort RPC method while executing command (AC 6.6.1)', () => {
  it('aborts running command immediately, kills child process, records status failed', async () => {
    const runId = 'abort-running-cmd'
    const runDir = path.join(tempDir, '.harness', 'runs', runId)

    const runPromise = runHarness(
      {
        name: 'cmd-abort-pipeline',
        steps: [
          {
            id: 'long-cmd-step',
            run: async (ctx) => {
              const res = await ctx.environments.host.exec(['node', '-e', 'setInterval(() => {}, 1000)'])
              return res
            },
          },
        ],
      },
      { runId, workspaceDir: tempDir },
    )

    const client = await waitForRunState(runDir, s => s.status === 'running' && s.activeStepId === 'long-cmd-step')
    const abortResult = await client.abort({ reason: 'Command interrupted by user', teardown: true })
    expect(abortResult.ok).toBe(true)
    await client.close()

    const result = await runPromise
    expect(result.status).toBe('failed')

    const state = readRunState(runDir)
    expect(state.status).toBe('failed')

    const events = readLedgerEvents(runDir)
    const failedEvent = events.find(e => e.eventType === 'run.failed')
    expect(failedEvent?.payload.error).toBe('Command interrupted by user')
    expect(fs.existsSync(path.join(runDir, RUNNER_PID_FILE))).toBe(false)
  })
})

describe('run.abort RPC method without teardown', () => {
  it('aborts without teardown when teardown flag is false', async () => {
    const runId = 'abort-no-teardown'
    const runDir = path.join(tempDir, '.harness', 'runs', runId)
    const { env: mockEnv, teardown: teardownMock } = createMockEnv('kept-env', tempDir)

    const runPromise = runHarness(
      makeGateConfig('abort-keep-pipeline', mockEnv, 'Review me:'),
      { runId, workspaceDir: tempDir },
    )

    const client = await waitForRunState(runDir, s => s.status === 'waiting_for_gate' && Boolean(s.activeGate))
    await client.abort({ reason: 'Cancel only', teardown: false })
    await client.close()

    const result = await runPromise
    expect(result.status).toBe('failed')
    expect(teardownMock).not.toHaveBeenCalled()
  })
})

describe('run.teardown RPC method on live runner', () => {
  it('tears down active environments via IPC call while run is active', async () => {
    const runId = 'live-teardown'
    const runDir = path.join(tempDir, '.harness', 'runs', runId)
    const { env: mockEnv, teardown: teardownMock } = createMockEnv('live-env', tempDir)

    const runPromise = runHarness(
      makeGateConfig('live-td-pipeline', mockEnv, 'Wait before teardown:'),
      { runId, workspaceDir: tempDir },
    )

    const client = await waitForRunState(runDir, s => s.status === 'waiting_for_gate' && Boolean(s.activeGate))
    const tdResult = await client.teardown({ force: true })
    expect(tdResult.ok).toBe(true)
    expect(teardownMock).toHaveBeenCalledTimes(1)

    await client.abort({ reason: 'Finished after teardown' })
    await client.close()
    await runPromise
  })
})

describe('run.abort pipeline interruption between steps', () => {
  it('stops pipeline execution immediately when aborted between steps', async () => {
    const runId = 'abort-between-steps'
    const runDir = path.join(tempDir, '.harness', 'runs', runId)
    let step2Executed = false

    const result = await runHarness(
      {
        name: 'two-step-abort-pipeline',
        steps: [
          {
            id: 'step-1',
            run: async () => {
              const client = await createControlClient(runDir)
              await client.abort({ reason: 'Cancel before step 2' })
              await client.close()
              return 'step1-ok'
            },
          },
          {
            id: 'step-2',
            run: async () => {
              step2Executed = true
              return 'step2-ok'
            },
          },
        ],
      },
      { runId, workspaceDir: tempDir },
    )

    expect(result.status).toBe('failed')
    expect(result.steps['step-1']?.status).toBe('passed')
    expect(result.steps['step-2']).toBeUndefined()
    expect(step2Executed).toBe(false)
  })
})
