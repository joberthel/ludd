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

function makeTestRail(status: 'pass' | 'skip' | 'fail', bodyOrLog?: any): Guardrail {
  return {
    __kind: 'guardrail',
    type: 'fn',
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
})

describe('runBeforeStepGuardrails empty guards', () => {
  it('returns empty string when beforeStep is undefined or empty', async () => {
    const snapshot: RunStateSnapshot = {
      schemaVersion: 1,
      runId: 'r-1',
      harnessName: 'test',
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
  it('executes guardrails sequentially and offloads logs without halting on fail', async () => {
    const snapshot: RunStateSnapshot = {
      schemaVersion: 1,
      runId: 'r-before',
      harnessName: 'test',
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
})

describe('runBeforeStepGuardrails error abortion (AC 5.3.4)', () => {
  it('aborts immediately when a beforeStep guardrail throws an Error', async () => {
    const snapshot: RunStateSnapshot = {
      schemaVersion: 1,
      runId: 'r-err',
      harnessName: 'test',
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
