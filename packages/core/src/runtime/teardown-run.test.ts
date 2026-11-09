import type { ProvisionedEnvironment } from '../types/environment.js'
import type { RunStateSnapshot } from '../types/state.js'
import fs from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RunAlreadyActiveError } from '../errors/run-already-active-error.js'
import { readLedgerEvents } from '../persistence/ledger-writer.js'
import { RUNNER_PID_FILE } from '../persistence/pid-lock.js'
import { readRunState, resolveRunDir, writeRunStateAtomic } from '../persistence/state-store.js'
import { teardownRun } from './teardown-run.js'

function createSnapshot(
  runId: string,
  status: RunStateSnapshot['status'],
  environments?: RunStateSnapshot['environments'],
): RunStateSnapshot {
  return {
    schemaVersion: 1,
    runId,
    harnessName: 'sample-harness',
    status,
    activeStepId: null,
    environments,
    steps: {},
    updatedAt: new Date().toISOString(),
  }
}

describe('teardownRun inactive runs (AC 6.6.2)', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-teardown-run-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('tears down inactive run with provisioned environments from options (AC 6.6.2)', async () => {
    const runId = 'inactive-run-options'
    const runDir = resolveRunDir(tempDir, runId)
    writeRunStateAtomic(runDir, createSnapshot(runId, 'passed', {
      custom: { id: 'custom', type: 'host', workingDir: tempDir },
    }))

    const teardownMock = vi.fn().mockResolvedValue(undefined)
    const mockEnv: ProvisionedEnvironment = {
      __kind: 'environment',
      id: 'custom',
      type: 'host',
      workingDir: tempDir,
      exec: vi.fn(),
      ping: vi.fn(),
      teardown: teardownMock,
    }

    const result = await teardownRun(runId, {
      workspaceDir: tempDir,
      environments: { custom: mockEnv },
    })

    expect(result.ok).toBe(true)
    expect(teardownMock).toHaveBeenCalledTimes(1)
    expect(readRunState(runDir).environments).toEqual({})

    const events = readLedgerEvents(runDir)
    const tdEvent = events.find(e => e.eventType === 'run.teardown')
    expect(tdEvent?.payload.environments).toEqual(['custom'])
  })

  it('tears down inactive run reconstructed from state.json descriptors (AC 6.6.2)', async () => {
    const runId = 'inactive-run-reconstructed'
    const runDir = resolveRunDir(tempDir, runId)
    writeRunStateAtomic(runDir, createSnapshot(runId, 'failed', {
      'env-a': { id: 'env-a', type: 'host', workingDir: tempDir },
    }))

    const result = await teardownRun(runId, { workspaceDir: tempDir })
    expect(result.ok).toBe(true)
    expect(readRunState(runDir).environments).toEqual({})

    const events = readLedgerEvents(runDir)
    expect(events.some(e => e.eventType === 'run.teardown')).toBe(true)
  })
})

describe('teardownRun active runner checks (AC 6.6.3)', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-teardown-run-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('throws RunAlreadyActiveError when runner is active without force (AC 6.6.3)', async () => {
    const runId = 'active-run-check'
    const runDir = resolveRunDir(tempDir, runId)
    writeRunStateAtomic(runDir, createSnapshot(runId, 'running'))
    fs.writeFileSync(path.join(runDir, RUNNER_PID_FILE), `${process.pid}\n`, 'utf-8')

    await expect(teardownRun(runId, { workspaceDir: tempDir })).rejects.toThrow(RunAlreadyActiveError)
  })

  it('proceeds with teardown when force: true is passed on active run', async () => {
    const runId = 'forced-active-run'
    const runDir = resolveRunDir(tempDir, runId)
    writeRunStateAtomic(runDir, createSnapshot(runId, 'running'))
    const pidFile = path.join(runDir, RUNNER_PID_FILE)
    fs.writeFileSync(pidFile, `${process.pid}\n`, 'utf-8')

    const result = await teardownRun(runId, { workspaceDir: tempDir, force: true })
    expect(result.ok).toBe(true)
    expect(fs.existsSync(pidFile)).toBe(false)
  })
})

describe('teardownRun dead runner pid and default cwd', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-teardown-run-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('ignores dead runner.pid file and proceeds normally', async () => {
    const runId = 'dead-pid-run'
    const runDir = resolveRunDir(tempDir, runId)
    writeRunStateAtomic(runDir, createSnapshot(runId, 'failed'))
    fs.writeFileSync(path.join(runDir, RUNNER_PID_FILE), '999999\n', 'utf-8')

    const result = await teardownRun(runId, { workspaceDir: tempDir })
    expect(result.ok).toBe(true)
  })

  it('defaults workspaceDir to process.cwd() when options are omitted', async () => {
    const runId = 'default-cwd-run'
    const runDir = resolveRunDir(tempDir, runId)
    writeRunStateAtomic(runDir, createSnapshot(runId, 'passed'))

    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tempDir)
    try {
      const result = await teardownRun(runId)
      expect(result.ok).toBe(true)
    }
    finally {
      cwdSpy.mockRestore()
    }
  })
})
