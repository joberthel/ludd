import type { ProvisionedEnvironment } from '../../types/environment.js'
import type { Guardrail } from '../../types/guardrail.js'
import type { StepConfig } from '../../types/harness.js'
import type { RunStateSnapshot } from '../../types/state.js'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { readLedgerEvents } from '../../persistence/ledger-writer.js'
import { writeRunStateAtomic } from '../../persistence/state-store.js'
import {
  emitStepRetry,
  formatGuardrailRetryPrompt,
  runAfterStepGuardrails,
} from '../guardrail-executor.js'

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'guardrail-helpers-test-'))
}

function makeInitialSnapshot(runDir: string): RunStateSnapshot {
  const snapshot: RunStateSnapshot = {
    schemaVersion: 1,
    runId: 'r-1',
    harnessName: 'test-harness',
    workflowName: 'test-harness',
    status: 'running',
    activeStepId: 'step-1',
    steps: {},
    updatedAt: new Date().toISOString(),
  }
  writeRunStateAtomic(runDir, snapshot)
  return snapshot
}

describe('guardrail executor prompt and ledger helpers', () => {
  it('formats retry prompt with text body, rawLog, or empty details', () => {
    const p1 = formatGuardrailRetryPrompt('do work', 0, { status: 'fail', body: 'type err' })
    expect(p1).toContain('The step failed afterStep guardrail #0.')
    expect(p1).toContain('Details: type err')

    const p2 = formatGuardrailRetryPrompt('do work', 1, {
      status: 'fail',
      body: { code: 123 },
    })
    expect(p2).toContain('Details: {"code":123}')

    const p3 = formatGuardrailRetryPrompt('do work', 2, { status: 'fail', rawLog: 'stack trace...' })
    expect(p3).toContain('Log output:\nstack trace...')

    const p4 = formatGuardrailRetryPrompt('do work', 3, { status: 'fail' })
    expect(p4).not.toContain('Details:')
    expect(p4).not.toContain('Log output:')
  })

  it('emits step.retry event to ledger', () => {
    const runDir = makeTempDir()
    try {
      const ctx = {
        runId: 'r-1',
        environments: {},
        steps: {},
        step: { id: 's-1', output: null, attempt: 2 },
        matrix: { index: 1, total: 3, item: 'a' },
        artifacts: {} as any,
      }
      emitStepRetry(runDir, ctx, 's-1', 'sess-1', 2, 'guardrail_failed', {
        verdict: { status: 'fail' },
      })
      const events = readLedgerEvents(runDir)
      expect(events).toHaveLength(1)
      expect(events[0].eventType).toBe('step.retry')
      expect(events[0].matrixIndex).toBe(1)
      expect(events[0].payload.reason).toBe('guardrail_failed')
    }
    finally {
      fs.rmSync(runDir, { recursive: true, force: true })
    }
  })
})

function makeMockEnv(id: string): ProvisionedEnvironment {
  return {
    __kind: 'environment',
    id,
    type: 'mock',
    workingDir: '/workspace',
    exec: async () => ({
      exitCode: 0,
      stdout: '',
      stderr: '',
      timedOut: false,
    }),
    ping: async () => true,
    teardown: async () => {},
  }
}

describe('guardrail executor dynamic environment resolution', () => {
  it('resolves guardrail environment property dynamically', async () => {
    const runDir = makeTempDir()
    try {
      const snapshot = makeInitialSnapshot(runDir)
      let receivedEnv: any
      const mockEnv = makeMockEnv('custom-container')
      const customRail: Guardrail = {
        __kind: 'guardrail',
        type: 'fn',
        environment: () => mockEnv,
        execute: async (input) => {
          receivedEnv = input.environment
          return { status: 'pass' }
        },
      }
      const step: StepConfig = {
        id: 's-1',
        afterStep: [customRail],
        run: async () => ({}),
      }
      const ctx = {
        runId: 'r-1',
        environments: {},
        steps: {},
        step: { id: 's-1', output: {}, attempt: 1 },
        matrix: undefined,
        artifacts: {} as any,
      }

      await runAfterStepGuardrails({
        step,
        ctx,
        snapshot,
        runDir,
        attempt: 1,
        maxTotalTurns: 5,
        initialPrompt: '',
      })

      expect(receivedEnv).toEqual(mockEnv)
    }
    finally {
      fs.rmSync(runDir, { recursive: true, force: true })
    }
  })
})

describe('guardrail executor inherited environment resolution', () => {
  it('inherits environment from ctx.environments[stepId] when guardrail.environment is undefined', async () => {
    const runDir = makeTempDir()
    try {
      const snapshot = makeInitialSnapshot(runDir)
      let receivedEnv: any
      const inheritedEnv = makeMockEnv('inherited-step-env')
      const defaultRail: Guardrail = {
        __kind: 'guardrail',
        type: 'fn',
        execute: async (input) => {
          receivedEnv = input.environment
          return { status: 'pass' }
        },
      }
      const step: StepConfig = {
        id: 's-step-env',
        afterStep: [defaultRail],
        run: async () => ({}),
      }
      const ctx = {
        runId: 'r-1',
        environments: {
          's-step-env': inheritedEnv,
        },
        steps: {},
        step: { id: 's-step-env', output: {}, attempt: 1 },
        matrix: undefined,
        artifacts: {} as any,
      }

      await runAfterStepGuardrails({
        step,
        ctx,
        snapshot,
        runDir,
        attempt: 1,
        maxTotalTurns: 5,
        initialPrompt: '',
      })

      expect(receivedEnv).toEqual(inheritedEnv)
    }
    finally {
      fs.rmSync(runDir, { recursive: true, force: true })
    }
  })
})
