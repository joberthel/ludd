import type { RunLifecycleContext } from '../types/harness.js'
import type { RunStateSnapshot } from '../types/state.js'
import fs from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HarnessConfigLoadError } from '../errors/harness-config-load-error.js'
import { RunAlreadyActiveError } from '../errors/run-already-active-error.js'
import { loaderInternals } from '../loader/load-harness-config.js'
import { readLedgerEvents } from '../persistence/ledger-writer.js'
import { RUNNER_PID_FILE } from '../persistence/pid-lock.js'
import { readRunState, resolveRunDir, writeRunStateAtomic } from '../persistence/state-store.js'
import { teardownRun } from './teardown-run.js'

function createSnapshot(
  runId: string,
  status: RunStateSnapshot['status'],
  overrides: Partial<RunStateSnapshot> = {},
): RunStateSnapshot {
  return {
    schemaVersion: 1,
    runId,
    harnessName: 'sample-harness',
    workflowName: 'sample-harness',
    status,
    activeStepId: status === 'running' || status === 'waiting_for_gate'
      ? 'step-1'
      : null,
    activeSessionId: status === 'running' || status === 'waiting_for_gate'
      ? 'sess-123'
      : null,
    activeMatrixIndex: status === 'running' || status === 'waiting_for_gate'
      ? 2
      : null,
    activeGate: status === 'waiting_for_gate'
      ? {
          stepId: 'step-1',
          phase: 'afterStep',
          guardrailIndex: 0,
          gateType: 'human_review',
          prompt: 'Approve?',
          createdAt: new Date().toISOString(),
        }
      : null,
    steps: {},
    updatedAt: new Date().toISOString(),
    ...overrides,
  }
}

describe('teardownRun user-defined teardown hook invocation', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-teardown-run-'))
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await rm(tempDir, { recursive: true, force: true })
  })

  it('loads persisted state.configPath and invokes harness teardown hook with lifecycle context', async () => {
    const runId = 'persisted-config-teardown'
    const runDir = resolveRunDir(tempDir, runId)
    const markerPath = path.join(tempDir, 'teardown-ran.json')
    const configFile = path.join(tempDir, 'custom.config.ts')

    fs.writeFileSync(
      configFile,
      [
        `import fs from 'node:fs'`,
        `import path from 'node:path'`,
        `import { defineHarness } from '@luddjs/core'`,
        `export default defineHarness({`,
        `  name: 'sample-harness',`,
        `  async teardown(ctx) {`,
        `    fs.writeFileSync(path.join(ctx.workspaceRoot, 'teardown-ran.json'), JSON.stringify({ runId: ctx.runId, workspaceRoot: ctx.workspaceRoot, aborted: ctx.signal.aborted }))`,
        `  },`,
        `  steps: [{ id: 'step-1', run: async () => 'ok' }],`,
        `})`,
      ].join('\n'),
      'utf-8',
    )

    writeRunStateAtomic(runDir, createSnapshot(runId, 'passed', { configPath: 'custom.config.ts' }))

    const abortController = new AbortController()
    const result = await teardownRun(runId, {
      workspaceDir: tempDir,
      signal: abortController.signal,
    })

    expect(result.ok).toBe(true)
    expect(JSON.parse(fs.readFileSync(markerPath, 'utf-8'))).toEqual({
      runId,
      workspaceRoot: tempDir,
      aborted: false,
    })

    const tdEvent = readLedgerEvents(runDir).find(e => e.eventType === 'run.teardown')
    expect(tdEvent?.payload).toEqual({ hookInvoked: true, forced: false })
    expect(readRunState(runDir).status).toBe('passed')
  })

  it('supports explicit teardown callback, config object, and configPath override', async () => {
    const runId1 = 'explicit-teardown-fn'
    const runDir1 = resolveRunDir(tempDir, runId1)
    writeRunStateAtomic(runDir1, createSnapshot(runId1, 'failed', { configPath: 'ignored.config.ts' }))

    let capturedCtx: RunLifecycleContext | undefined
    const teardownSpy = vi.fn(async (ctx: RunLifecycleContext) => {
      capturedCtx = ctx
    })

    await expect(teardownRun(runId1, {
      workspaceDir: tempDir,
      teardown: teardownSpy,
    })).resolves.toEqual({ ok: true })
    expect(teardownSpy).toHaveBeenCalledTimes(1)
    expect(capturedCtx?.runId).toBe(runId1)
    expect(capturedCtx?.workspaceRoot).toBe(tempDir)
    expect(capturedCtx?.signal.aborted).toBe(false)

    const runId2 = 'explicit-config-obj'
    const runDir2 = resolveRunDir(tempDir, runId2)
    writeRunStateAtomic(runDir2, createSnapshot(runId2, 'passed'))
    const configTeardown = vi.fn(async () => {})
    await teardownRun(runId2, {
      workspaceDir: tempDir,
      config: { teardown: configTeardown },
    })
    expect(configTeardown).toHaveBeenCalledTimes(1)

    const runId3 = 'override-config-path'
    const runDir3 = resolveRunDir(tempDir, runId3)
    const markerFile = path.join(tempDir, 'override-marker.txt')
    fs.writeFileSync(
      path.join(tempDir, 'override.config.ts'),
      [
        `import fs from 'node:fs'`,
        `import path from 'node:path'`,
        `export default {`,
        `  name: 'override',`,
        `  teardown: async (ctx) => { fs.writeFileSync(path.join(ctx.workspaceRoot, 'override-marker.txt'), ctx.runId) },`,
        `  steps: [{ id: 's1', run: () => 'ok' }],`,
        `}`,
      ].join('\n'),
      'utf-8',
    )
    writeRunStateAtomic(runDir3, createSnapshot(runId3, 'passed', { configPath: 'unused.config.ts' }))
    await teardownRun(runId3, {
      workspaceDir: tempDir,
      configPath: 'override.config.ts',
    })
    expect(fs.readFileSync(markerFile, 'utf-8')).toBe(runId3)
  })

  it('completes cleanly when config has no teardown hook or configPath is absent/blank', async () => {
    const runId1 = 'config-without-teardown'
    const runDir1 = resolveRunDir(tempDir, runId1)
    fs.writeFileSync(
      path.join(tempDir, 'no-td.config.ts'),
      `export default { name: 'no-td', steps: [{ id: 's1', run: () => 'ok' }] }`,
      'utf-8',
    )
    writeRunStateAtomic(runDir1, createSnapshot(runId1, 'passed', { configPath: 'no-td.config.ts' }))
    await expect(teardownRun(runId1, { workspaceDir: tempDir })).resolves.toEqual({ ok: true })
    expect(readLedgerEvents(runDir1).find(e => e.eventType === 'run.teardown')?.payload).toEqual({
      hookInvoked: false,
      forced: false,
    })

    const runId2 = 'blank-config-path'
    const runDir2 = resolveRunDir(tempDir, runId2)
    writeRunStateAtomic(runDir2, createSnapshot(runId2, 'passed', { configPath: '   ' }))
    await expect(teardownRun(runId2, { workspaceDir: tempDir })).resolves.toEqual({ ok: true })
    expect(readLedgerEvents(runDir2).find(e => e.eventType === 'run.teardown')?.payload.hookInvoked).toBe(false)
  })

  it('throws on missing or corrupt explicit configPath even with force, and skips missing/corrupt persisted config only with force', async () => {
    const runId1 = 'explicit-missing-config'
    const runDir1 = resolveRunDir(tempDir, runId1)
    writeRunStateAtomic(runDir1, createSnapshot(runId1, 'running'))
    const pid1 = path.join(runDir1, RUNNER_PID_FILE)
    fs.writeFileSync(pid1, `${process.pid}\n`, 'utf-8')

    await expect(teardownRun(runId1, {
      workspaceDir: tempDir,
      configPath: 'missing-explicit.ts',
      force: true,
    })).rejects.toThrow(HarnessConfigLoadError)
    await expect(teardownRun(runId1, {
      workspaceDir: tempDir,
      configPath: '   ',
      force: true,
    })).rejects.toThrow(HarnessConfigLoadError)
    expect(fs.existsSync(pid1)).toBe(true)

    const runId2 = 'persisted-missing-no-force'
    const runDir2 = resolveRunDir(tempDir, runId2)
    writeRunStateAtomic(runDir2, createSnapshot(runId2, 'failed', { configPath: 'deleted.config.ts' }))
    await expect(teardownRun(runId2, { workspaceDir: tempDir })).rejects.toThrow(HarnessConfigLoadError)

    const runId3 = 'persisted-missing-with-force'
    const runDir3 = resolveRunDir(tempDir, runId3)
    writeRunStateAtomic(runDir3, createSnapshot(runId3, 'running', { configPath: 'deleted.config.ts' }))
    const pid3 = path.join(runDir3, RUNNER_PID_FILE)
    fs.writeFileSync(pid3, `${process.pid}\n`, 'utf-8')

    await expect(teardownRun(runId3, { workspaceDir: tempDir, force: true })).resolves.toEqual({ ok: true })
    expect(fs.existsSync(pid3)).toBe(false)
    expect(readRunState(runDir3).status).toBe('failed')
    expect(readLedgerEvents(runDir3).find(e => e.eventType === 'run.teardown')?.payload).toEqual({
      hookInvoked: false,
      forced: true,
    })

    const runId4 = 'persisted-corrupt-with-force'
    const runDir4 = resolveRunDir(tempDir, runId4)
    fs.writeFileSync(path.join(tempDir, 'corrupt.config.ts'), 'export default {', 'utf-8')
    writeRunStateAtomic(runDir4, createSnapshot(runId4, 'waiting_for_gate', { configPath: 'corrupt.config.ts' }))
    await expect(teardownRun(runId4, { workspaceDir: tempDir, force: true })).resolves.toEqual({ ok: true })
    expect(readRunState(runDir4).status).toBe('failed')
    expect(readLedgerEvents(runDir4).find(e => e.eventType === 'run.teardown')?.payload.hookInvoked).toBe(false)

    const runId5 = 'persisted-non-load-error-with-force'
    const runDir5 = resolveRunDir(tempDir, runId5)
    fs.writeFileSync(
      path.join(tempDir, 'valid-stub.config.ts'),
      `export default { name: 'stub', steps: [{ id: 's1', run: () => 'ok' }] }`,
      'utf-8',
    )
    writeRunStateAtomic(runDir5, createSnapshot(runId5, 'running', { configPath: 'valid-stub.config.ts' }))
    vi.spyOn(loaderInternals, 'resolveOptionalPackage').mockRejectedValueOnce(new Error('unexpected resolver crash'))
    await expect(teardownRun(runId5, { workspaceDir: tempDir, force: true })).rejects.toThrow('unexpected resolver crash')
  })

  it('propagates teardown errors and preserves runner.pid under force: true', async () => {
    const runId = 'teardown-throws'
    const runDir = resolveRunDir(tempDir, runId)
    writeRunStateAtomic(runDir, createSnapshot(runId, 'running'))
    const pidPath = path.join(runDir, RUNNER_PID_FILE)
    fs.writeFileSync(pidPath, `${process.pid}\n`, 'utf-8')

    await expect(teardownRun(runId, {
      workspaceDir: tempDir,
      force: true,
      teardown: async () => {
        throw new Error('teardown failed')
      },
    })).rejects.toThrow('teardown failed')

    expect(fs.existsSync(pidPath)).toBe(true)
    expect(readRunState(runDir).status).toBe('running')
    expect(readLedgerEvents(runDir)).toEqual([])
  })
})

describe('teardownRun state finalization, pid checks, and defaults', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-teardown-run-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('finalizes incomplete running or waiting_for_gate states to failed and clears active pointers', async () => {
    const runningId = 'incomplete-running'
    const runningDir = resolveRunDir(tempDir, runningId)
    writeRunStateAtomic(runningDir, createSnapshot(runningId, 'running'))
    await teardownRun(runningId, { workspaceDir: tempDir })
    const runningState = readRunState(runningDir)
    expect(runningState.status).toBe('failed')
    expect(runningState.activeStepId).toBeNull()
    expect(runningState.activeGate).toBeNull()
    expect(runningState.activeSessionId).toBeNull()
    expect(runningState.activeMatrixIndex).toBeNull()

    const waitingId = 'incomplete-waiting'
    const waitingDir = resolveRunDir(tempDir, waitingId)
    writeRunStateAtomic(waitingDir, createSnapshot(waitingId, 'waiting_for_gate'))
    await teardownRun(waitingId, { workspaceDir: tempDir })
    const waitingState = readRunState(waitingDir)
    expect(waitingState.status).toBe('failed')
    expect(waitingState.activeStepId).toBeNull()
    expect(waitingState.activeGate).toBeNull()
    expect(waitingState.activeSessionId).toBeNull()
    expect(waitingState.activeMatrixIndex).toBeNull()
  })

  it('throws RunAlreadyActiveError when runner is active without force', async () => {
    const runId = 'active-run-check'
    const runDir = resolveRunDir(tempDir, runId)
    writeRunStateAtomic(runDir, createSnapshot(runId, 'running'))
    fs.writeFileSync(path.join(runDir, RUNNER_PID_FILE), `${process.pid}\n`, 'utf-8')

    await expect(teardownRun(runId, { workspaceDir: tempDir })).rejects.toThrow(RunAlreadyActiveError)
  })

  it('proceeds with teardown and removes pid file after state update when force: true is passed on active run', async () => {
    const runId = 'forced-active-run'
    const runDir = resolveRunDir(tempDir, runId)
    writeRunStateAtomic(runDir, createSnapshot(runId, 'running'))
    const pidFile = path.join(runDir, RUNNER_PID_FILE)
    fs.writeFileSync(pidFile, `${process.pid}\n`, 'utf-8')

    const result = await teardownRun(runId, { workspaceDir: tempDir, force: true })
    expect(result.ok).toBe(true)
    expect(fs.existsSync(pidFile)).toBe(false)
    expect(readRunState(runDir).status).toBe('failed')
    expect(readLedgerEvents(runDir).find(e => e.eventType === 'run.teardown')?.payload.forced).toBe(true)
  })

  it('ignores dead runner.pid file and proceeds normally', async () => {
    const runId = 'dead-pid-run'
    const runDir = resolveRunDir(tempDir, runId)
    writeRunStateAtomic(runDir, createSnapshot(runId, 'failed'))
    fs.writeFileSync(path.join(runDir, RUNNER_PID_FILE), '999999\n', 'utf-8')

    const result = await teardownRun(runId, { workspaceDir: tempDir })
    expect(result.ok).toBe(true)
  })

  it('returns ok: true when state.json does not exist in run directory', async () => {
    const runId = 'missing-state-run'
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
