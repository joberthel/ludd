import type { Guardrail } from '../types/guardrail.js'
import type { StepConfig } from '../types/harness.js'
import type { RunStateSnapshot } from '../types/state.js'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readLedgerEvents } from '../persistence/ledger-writer.js'
import { readRunState, writeRunStateAtomic } from '../persistence/state-store.js'
import {
  formatBeforeStepNotification,
  runBeforeStepGuardrails,
} from './before-step-executor.js'

let tempDir: string

beforeEach(async () => {
  tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ludd-before-step-'))
})

afterEach(async () => {
  await fs.promises.rm(tempDir, { recursive: true, force: true })
})

function makeTestRail(status: 'pass' | 'skip' | 'fail', bodyOrLog?: any, name?: string): Guardrail {
  return {
    __kind: 'guardrail',
    type: 'fn',
    ...(name !== undefined
      ? { name }
      : {}),
    execute: async () => {
      const isLog = typeof bodyOrLog === 'string' && bodyOrLog.includes('\n')
      return {
        status,
        rawLog: isLog ? bodyOrLog : undefined,
        body: !isLog
          ? bodyOrLog
          : undefined,
      }
    },
  }
}

describe('before-step-executor notification formatting', () => {
  it('returns empty string when results are empty', () => {
    expect(formatBeforeStepNotification([])).toBe('')
  })

  it('formats notification referencing log keys and status', () => {
    const notification = formatBeforeStepNotification([
      {
        guardrailIndex: 0,
        verdict: { status: 'pass' },
        logKey: 'step-1-1-beforeStep-0',
      },
      {
        guardrailIndex: 1,
        verdict: { status: 'fail' },
        logKey: 'step-1-1-beforeStep-1',
      },
    ])
    expect(notification).toContain('Context from beforeStep guardrails is available via MCP tools:')
    expect(notification).toContain('- Guardrail #0: logKey="step-1-1-beforeStep-0" (status: pass)')
    expect(notification).toContain('- Guardrail #1: logKey="step-1-1-beforeStep-1" (status: fail)')
    expect(notification).toContain('read_log_page, read_log_lines, or search_log')
  })

  it('formats user feedback section when feedback is present in results', () => {
    const notification = formatBeforeStepNotification([
      {
        guardrailIndex: 0,
        verdict: { status: 'pass' },
        logKey: 'step-1-1-beforeStep-0',
        feedback: 'Please implement SSO login with Google OAuth.',
      },
    ])
    expect(notification).toContain('User feedback (Guardrail #0):\nPlease implement SSO login with Google OAuth.')
  })
})

describe('runBeforeStepGuardrails empty guards', () => {
  it('returns empty string when beforeStep is undefined or empty', async () => {
    const snapshot: RunStateSnapshot = {
      schemaVersion: 1,
      runId: 'r-1',
      harnessName: 'test',
      workflowName: 'test',
      status: 'running',
      activeStepId: 'step-1',
      steps: {},
      updatedAt: new Date().toISOString(),
    }
    const step: StepConfig = {
      id: 'step-1',
      run: async () => ({}),
    }
    const ctx = {
      runId: 'r-1',
      environments: {},
      steps: {},
      step: { id: 'step-1', output: null, attempt: 1 },
      matrix: undefined,
      artifacts: {} as any,
    }

    const res1 = await runBeforeStepGuardrails({ step, ctx, snapshot, runDir: tempDir })
    expect(res1).toBe('')

    const stepEmpty: StepConfig = {
      id: 'step-1',
      beforeStep: [],
      run: async () => ({}),
    }
    const res2 = await runBeforeStepGuardrails({
      step: stepEmpty,
      ctx,
      snapshot,
      runDir: tempDir,
    })
    expect(res2).toBe('')
  })
})

describe('runBeforeStepGuardrails sequential execution', () => {
  it('restores partial results for keyed and indexed guardrail sets', async () => {
    const createSnapshot = (activeBeforeStepResults: unknown): RunStateSnapshot => ({
      schemaVersion: 1,
      runId: 'r-restore',
      harnessName: 'test',
      workflowName: 'test',
      status: 'running',
      activeStepId: 'restore',
      activeBeforeStepResults,
      steps: {},
      updatedAt: new Date().toISOString(),
    })
    const ctx = {
      runId: 'r-restore',
      environments: {},
      steps: {},
      step: { id: 'restore', output: null, attempt: 1 },
      matrix: undefined,
      artifacts: {} as any,
    }
    const keyedSnapshot = createSnapshot({ first: 'saved' })
    await runBeforeStepGuardrails({
      step: {
        id: 'restore',
        beforeStep: {
          first: makeTestRail('pass'),
          second: makeTestRail('pass', 'fresh'),
        },
        run: () => null,
      },
      ctx,
      snapshot: keyedSnapshot,
      runDir: tempDir,
      startIndex: 1,
    })
    expect((ctx as typeof ctx & { beforeStep: Record<string, unknown> }).beforeStep).toEqual({ first: 'saved', second: 'fresh' })

    const arraySnapshot = createSnapshot(['saved'])
    await runBeforeStepGuardrails({
      step: {
        id: 'restore',
        beforeStep: [
          makeTestRail('pass'),
          makeTestRail('pass', 'fresh'),
        ],
        run: () => null,
      },
      ctx,
      snapshot: arraySnapshot,
      runDir: tempDir,
      startIndex: 1,
    })
    expect((ctx as typeof ctx & { beforeStep: unknown[] }).beforeStep).toEqual(['saved', 'fresh'])
  })

  it('rejects an invalid guardrail in a keyed factory result', async () => {
    const snapshot: RunStateSnapshot = {
      schemaVersion: 1,
      runId: 'r-key-error',
      harnessName: 'test',
      workflowName: 'test',
      status: 'running',
      activeStepId: 'key-error',
      steps: {},
      updatedAt: new Date().toISOString(),
    }
    const step: StepConfig = {
      id: 'key-error',
      beforeStep: (() => ({ bad: null })) as never,
      run: () => null,
    }
    const ctx = {
      runId: 'r-key-error',
      environments: {},
      steps: {},
      step: { id: 'key-error', output: null, attempt: 1 },
      matrix: undefined,
      artifacts: {} as any,
    }
    await expect(runBeforeStepGuardrails({ step, ctx, snapshot, runDir: tempDir })).rejects.toThrow('at key "bad".')
  })

  it('executes guardrails sequentially and offloads logs without halting on fail', async () => {
    const snapshot: RunStateSnapshot = {
      schemaVersion: 1,
      runId: 'r-before',
      harnessName: 'test',
      workflowName: 'test',
      status: 'running',
      activeStepId: 's-1',
      steps: {},
      updatedAt: new Date().toISOString(),
    }
    writeRunStateAtomic(tempDir, snapshot)

    const step: StepConfig = {
      id: 's-1',
      beforeStep: [
        makeTestRail('pass', 'commit history log line 1\nline 2'),
        makeTestRail('skip', 'skipped check'),
        makeTestRail('fail', { warning: 'dirty working tree' }),
        makeTestRail('pass'),
      ],
      run: async () => ({}),
    }
    const ctx = {
      runId: 'r-before',
      environments: {},
      steps: {},
      step: { id: 's-1', output: null, attempt: 1 },
      matrix: undefined,
      artifacts: {} as any,
    }

    const notification = await runBeforeStepGuardrails({ step, ctx, snapshot, runDir: tempDir })
    expect(notification).toContain('- Guardrail #0: logKey="s-1-1-beforeStep-0" (status: pass)')
    expect(notification).toContain('- Guardrail #2: logKey="s-1-1-beforeStep-2" (status: fail)')

    const eventTypes = readLedgerEvents(tempDir).map(e => e.eventType)
    expect(eventTypes).toEqual([
      'guardrail.started',
      'guardrail.passed',
      'guardrail.started',
      'guardrail.skipped',
      'guardrail.started',
      'guardrail.failed',
      'guardrail.started',
      'guardrail.passed',
    ])

    const reloaded = readRunState(tempDir)
    expect(reloaded.logs?.['s-1-1-beforeStep-0']?.totalLines).toBe(2)
  })

  it('includes guardrailName in beforeStep ledger events only when guardrail.name is set (not object-map keys)', async () => {
    const snapshot: RunStateSnapshot = {
      schemaVersion: 1,
      runId: 'r-named-before',
      harnessName: 'test',
      workflowName: 'test',
      status: 'running',
      activeStepId: 's-named',
      steps: {},
      updatedAt: new Date().toISOString(),
    }
    writeRunStateAtomic(tempDir, snapshot)

    const step: StepConfig = {
      id: 's-named',
      beforeStep: {
        namedKey: makeTestRail('pass', 'ok', 'git-status'),
        unnamedKey: makeTestRail('skip', 'skipped'),
        failedKey: makeTestRail('fail', 'err', 'policy-check'),
      },
      run: async () => ({}),
    }
    const ctx = {
      runId: 'r-named-before',
      environments: {},
      steps: {},
      step: { id: 's-named', output: null, attempt: 1 },
      matrix: undefined,
      artifacts: {} as any,
    }

    await runBeforeStepGuardrails({ step, ctx, snapshot, runDir: tempDir })

    const events = readLedgerEvents(tempDir)
    expect(events.map(e => [e.eventType, e.payload.guardrailName])).toEqual([
      ['guardrail.started', 'git-status'],
      ['guardrail.passed', 'git-status'],
      ['guardrail.started', undefined],
      ['guardrail.skipped', undefined],
      ['guardrail.started', 'policy-check'],
      ['guardrail.failed', 'policy-check'],
    ])
  })
})

describe('runBeforeStepGuardrails error abortion (AC 5.3.4)', () => {
  it('aborts immediately when a beforeStep guardrail throws an Error', async () => {
    const snapshot: RunStateSnapshot = {
      schemaVersion: 1,
      runId: 'r-err',
      harnessName: 'test',
      workflowName: 'test',
      status: 'running',
      activeStepId: 's-err',
      steps: {},
      updatedAt: new Date().toISOString(),
    }
    const throwingRail: Guardrail = {
      __kind: 'guardrail',
      type: 'fn',
      execute: async () => {
        throw new Error('Fatal beforeStep network failure')
      },
    }
    const step: StepConfig = {
      id: 's-err',
      beforeStep: [throwingRail],
      run: async () => ({}),
    }
    const ctx = {
      runId: 'r-err',
      environments: {},
      steps: {},
      step: { id: 's-err', output: null, attempt: 1 },
      matrix: undefined,
      artifacts: {} as any,
    }

    await expect(runBeforeStepGuardrails({ step, ctx, snapshot, runDir: tempDir })).rejects.toThrow(
      'Fatal beforeStep network failure',
    )
  })
})

describe('runBeforeStepGuardrails partial rehydration', () => {
  it('reconstructs notifications for guardrails 0 .. startIndex - 1 from logs and ledger', async () => {
    const snapshot: RunStateSnapshot = {
      schemaVersion: 1,
      runId: 'r-rehydrate',
      harnessName: 'test',
      workflowName: 'test',
      status: 'running',
      activeStepId: 's-rehydrate',
      steps: {},
      logs: {
        's-rehydrate-1-beforeStep-0': {
          logKey: 's-rehydrate-1-beforeStep-0',
          stepId: 's-rehydrate',
          attempt: 1,
          phase: 'beforeStep',
          guardrailIndex: 0,
          filePath: 'logs/s-rehydrate-1-beforeStep-0.log',
          format: 'text',
          totalLines: 1,
          totalItems: 1,
          createdAt: new Date().toISOString(),
        },
      },
      updatedAt: new Date().toISOString(),
    }
    const ctx = {
      runId: 'r-rehydrate',
      environments: {},
      steps: {},
      step: { id: 's-rehydrate', output: null, attempt: 1 },
      matrix: undefined,
      artifacts: {} as any,
    }
    const rail0: Guardrail = {
      __kind: 'guardrail',
      type: 'fn',
      execute: async () => {
        throw new Error('rail0 should not be re-executed')
      },
    }
    const rail1: Guardrail = {
      __kind: 'guardrail',
      type: 'fn',
      execute: async () => ({ status: 'pass', body: 'ok-1' }),
    }
    const step: StepConfig = {
      id: 's-rehydrate',
      beforeStep: [rail0, rail1],
      run: async () => ({}),
    }

    const { appendLedgerEvent } = await import('../persistence/ledger-writer.js')
    appendLedgerEvent(tempDir, {
      schemaVersion: 1,
      timestamp: new Date().toISOString(),
      runId: 'r-rehydrate',
      stepId: 's-rehydrate',
      eventType: 'guardrail.passed',
      payload: {
        phase: 'beforeStep',
        guardrailIndex: 0,
        attempt: 1,
        verdict: { status: 'pass', body: 'ok-0' },
      },
    })
    appendLedgerEvent(tempDir, {
      schemaVersion: 1,
      timestamp: new Date().toISOString(),
      runId: 'r-rehydrate',
      stepId: 's-rehydrate',
      eventType: 'gate.resolved',
      payload: {
        phase: 'beforeStep',
        guardrailIndex: 0,
        action: 'pass',
        feedback: 'prior feedback',
      },
    })

    const notification = await runBeforeStepGuardrails({
      step,
      ctx,
      snapshot,
      runDir: tempDir,
      startIndex: 1,
    })

    expect(notification).toContain('Guardrail #0: logKey="s-rehydrate-1-beforeStep-0" (status: pass)')
    expect(notification).toContain('Guardrail #1: logKey="s-rehydrate-1-beforeStep-1" (status: pass)')
    expect(notification).toContain('User feedback (Guardrail #0):\nprior feedback')
  })

  it('reconstructs skipped/failed statuses and matrix fallback when payload.verdict is absent', async () => {
    const snapshot: RunStateSnapshot = {
      schemaVersion: 1,
      runId: 'r-rehydrate-2',
      harnessName: 'test',
      workflowName: 'test',
      status: 'running',
      activeStepId: 's-rehydrate-2',
      steps: {},
      logs: {
        's-rehydrate-2-1-beforeStep-0': {
          logKey: 's-rehydrate-2-1-beforeStep-0',
          stepId: 's-rehydrate-2',
          attempt: 1,
          phase: 'beforeStep',
          guardrailIndex: 0,
          filePath: 'logs/s-rehydrate-2-1-beforeStep-0.log',
          format: 'text',
          totalLines: 1,
          totalItems: 1,
          createdAt: new Date().toISOString(),
        },
      },
      updatedAt: new Date().toISOString(),
    }
    const ctx = {
      runId: 'r-rehydrate-2',
      environments: {},
      steps: {},
      step: { id: 's-rehydrate-2', output: null, attempt: 1 },
      matrix: { item: 'a', index: 0, total: 1 },
      artifacts: {} as any,
    }
    const rail: Guardrail = {
      __kind: 'guardrail',
      type: 'fn',
      execute: async () => ({ status: 'pass', body: 'ok' }),
    }
    const step: StepConfig = {
      id: 's-rehydrate-2',
      beforeStep: [rail, rail, rail, rail],
      run: async () => ({}),
    }

    const { appendLedgerEvent } = await import('../persistence/ledger-writer.js')
    const entries = [
      [0, 'guardrail.skipped'],
      [1, 'guardrail.failed'],
      [2, 'guardrail.passed'],
    ] as const
    for (const [idx, eventType] of entries) {
      appendLedgerEvent(tempDir, {
        schemaVersion: 1,
        timestamp: new Date().toISOString(),
        runId: 'r-rehydrate-2',
        stepId: 's-rehydrate-2',
        matrixIndex: 0,
        eventType,
        payload: { phase: 'beforeStep', guardrailIndex: idx, attempt: 1 },
      })
    }

    const notification = await runBeforeStepGuardrails({
      step,
      ctx,
      snapshot,
      runDir: tempDir,
      startIndex: 3,
    })

    expect(notification).toContain('Guardrail #0: logKey="s-rehydrate-2-1-beforeStep-0" (status: skip)')
    expect(notification).toContain('Guardrail #1: logKey="" (status: fail)')
    expect(notification).toContain('Guardrail #2: logKey="" (status: pass)')
    expect(notification).toContain('Guardrail #3: logKey="s-rehydrate-2-m0-1-beforeStep-3" (status: pass)')
  })
})

describe('runBeforeStepGuardrails host execution context forwarding', () => {
  it('forwards explicit cwd, env, and signal (with gateWaiter fallback) to guardrail.execute', async () => {
    const { createGateWaiter } = await import('./gate-waiter.js')
    const snapshot: RunStateSnapshot = {
      schemaVersion: 1,
      runId: 'r-ctx',
      harnessName: 'test',
      workflowName: 'test',
      status: 'running',
      activeStepId: 's-ctx',
      steps: {},
      updatedAt: new Date().toISOString(),
    }
    writeRunStateAtomic(tempDir, snapshot)

    const seen: Array<{ cwd: string, env: Record<string, string>, signal?: AbortSignal }> = []
    const rail: Guardrail = {
      __kind: 'guardrail',
      type: 'exec',
      execute: async (input) => {
        seen.push({ cwd: input.cwd, env: input.env, signal: input.signal })
        return { status: 'pass' }
      },
    }
    const ctx = {
      runId: 'r-ctx',
      environments: {},
      steps: {},
      step: { id: 's-ctx', output: null, attempt: 1 },
      matrix: undefined,
      artifacts: {} as any,
    }
    const explicitController = new AbortController()
    await runBeforeStepGuardrails({
      step: {
        id: 's-ctx',
        beforeStep: [rail],
        run: () => null,
      },
      ctx,
      snapshot,
      runDir: tempDir,
      cwd: '/custom/worktree',
      env: { FOO: 'bar' },
      signal: explicitController.signal,
    })

    const waiterController = new AbortController()
    const waiter = createGateWaiter(waiterController.signal)
    await runBeforeStepGuardrails({
      step: {
        id: 's-ctx',
        beforeStep: [rail],
        run: () => null,
      },
      ctx,
      snapshot,
      runDir: tempDir,
      gateWaiter: waiter,
    })

    expect(seen[0]).toEqual({
      cwd: '/custom/worktree',
      env: { FOO: 'bar' },
      signal: explicitController.signal,
    })
    expect(seen[1]).toEqual({
      cwd: process.cwd(),
      env: {},
      signal: waiterController.signal,
    })
  })
})
