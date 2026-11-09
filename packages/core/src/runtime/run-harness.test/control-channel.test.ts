import type { RunStateSnapshot } from '../../types/state.js'
import fs from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createControlClient } from '../../ipc/control-client.js'
import { CONTROL_SOCKET_NAME, getControlSocketPath } from '../../ipc/socket-path.js'
import { RUNNER_PID_FILE } from '../../persistence/pid-lock.js'
import { runHarness } from '../run-harness.js'

describe('runHarness control server live status inspection', () => {
  let tempDir: string

  beforeEach(async () => {
    const baseDir = process.platform === 'win32'
      ? os.tmpdir()
      : '/tmp'
    tempDir = await mkdtemp(path.join(baseDir, 'l-c-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('serves live RunStateSnapshot via control client during step execution', async () => {
    const runId = 'live-run'
    const runDir = path.join(tempDir, '.harness', 'runs', runId)
    let observedSnapshot: RunStateSnapshot | undefined

    const result = await runHarness(
      {
        name: 'live-control-harness',
        steps: [
          {
            id: 'observe-step',
            run: async () => {
              const client = await createControlClient(runDir)
              observedSnapshot = await client.status()
              await client.close()
              return 'observed'
            },
          },
        ],
      },
      { runId, workspaceDir: tempDir },
    )

    expect(result.status).toBe('passed')
    expect(observedSnapshot).toBeDefined()
    expect(observedSnapshot?.runId).toBe(runId)
    expect(observedSnapshot?.activeStepId).toBe('observe-step')
    expect(observedSnapshot?.status).toBe('running')

    const sockPath = getControlSocketPath(runDir)
    if (process.platform !== 'win32') {
      expect(fs.existsSync(sockPath)).toBe(false)
    }
  })
})

describe('runHarness control server cleanup on step failure', () => {
  let tempDir: string

  beforeEach(async () => {
    const baseDir = process.platform === 'win32'
      ? os.tmpdir()
      : '/tmp'
    tempDir = await mkdtemp(path.join(baseDir, 'l-c-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('cleans up control server and socket file on step failure', async () => {
    const runId = 'fail-run'
    const runDir = path.join(tempDir, '.harness', 'runs', runId)

    const result = await runHarness(
      {
        name: 'failing-control-harness',
        steps: [
          {
            id: 'failing-step',
            run: async () => {
              throw new Error('step exploded')
            },
          },
        ],
      },
      { runId, workspaceDir: tempDir },
    )

    expect(result.status).toBe('failed')
    const sockPath = getControlSocketPath(runDir)
    if (process.platform !== 'win32') {
      expect(fs.existsSync(sockPath)).toBe(false)
    }
  })
})

describe('runHarness control server recovery from dead process', () => {
  let tempDir: string

  beforeEach(async () => {
    const baseDir = process.platform === 'win32'
      ? os.tmpdir()
      : '/tmp'
    tempDir = await mkdtemp(path.join(baseDir, 'l-c-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('unlinks stale control.sock left by dead process on startup and completes', async () => {
    const runId = 'recover-run'
    const runDir = path.join(tempDir, '.harness', 'runs', runId)
    fs.mkdirSync(runDir, { recursive: true })

    const pidFile = path.join(runDir, RUNNER_PID_FILE)
    const sockFile = path.join(runDir, CONTROL_SOCKET_NAME)
    fs.writeFileSync(pidFile, '999999\n', 'utf-8')
    fs.writeFileSync(sockFile, 'stale-socket-stub', 'utf-8')

    let liveObserved = false
    const result = await runHarness(
      {
        name: 'recovery-harness',
        steps: [
          {
            id: 'check-recovered',
            run: async () => {
              const client = await createControlClient(runDir)
              const status = await client.status()
              liveObserved = status.activeStepId === 'check-recovered'
              await client.close()
              return 'ok'
            },
          },
        ],
      },
      { runId, workspaceDir: tempDir },
    )

    expect(result.status).toBe('passed')
    expect(liveObserved).toBe(true)
    if (process.platform !== 'win32') {
      expect(fs.existsSync(sockFile)).toBe(false)
    }
  })
})
