import type { Guardrail } from '../../types/guardrail.js'
import type { StepConfig } from '../../types/harness.js'
import type { RunStateSnapshot } from '../../types/state.js'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createLogStore } from '../../mcp/log-store.js'
import { readRunState, writeRunStateAtomic } from '../../persistence/state-store.js'
import { executeHumanReviewBeforeStepGuardrail } from '../before-step-human-review.js'
import { createGateWaiter } from '../gate-waiter.js'

function makeContext(snapshot: RunStateSnapshot) {
  const step: StepConfig = {
    id: 'step-clarify',
    run: async () => ({}),
  }
  const ctx = {
    runId: snapshot.runId,
    environments: {},
    steps: {},
    step: { id: 'step-clarify', output: null, attempt: 1 },
    matrix: undefined as { index: number, total: number, item: unknown } | undefined,
    artifacts: {} as any,
  }
  return { step, ctx }
}

function makeSnapshot(): RunStateSnapshot {
  return {
    schemaVersion: 1,
    runId: 'r-hr',
    harnessName: 'test-harness',
    status: 'running',
    activeStepId: 'step-clarify',
    steps: {},
    updatedAt: new Date().toISOString(),
  }
}

let tempDir: string

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-hr-branches-test-'))
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

describe('executeHumanReviewBeforeStepGuardrail matrix context', () => {
  it('records matrixIndex in activeGate when step is executing in matrix context', async () => {
    const snapshot = makeSnapshot()
    writeRunStateAtomic(tempDir, snapshot)
    const { step, ctx } = makeContext(snapshot)
    ctx.matrix = {
      index: 3,
      total: 5,
      item: { id: 'slice-3' },
    }
    const logStore = createLogStore(tempDir)
    const waiter = createGateWaiter()

    const guardrail = {
      __kind: 'guardrail' as const,
      type: 'human_review' as const,
      prompt: 'Review slice 3',
      execute: async () => ({ status: 'pass' as const }),
    }

    const p = executeHumanReviewBeforeStepGuardrail(
      {
        step,
        ctx,
        snapshot,
        runDir: tempDir,
        gateWaiter: waiter,
      },
      guardrail,
      0,
      logStore,
    )
    await new Promise(r => setTimeout(r, 10))

    const activeGate = waiter.getActiveGate()
    expect(activeGate?.matrixIndex).toBe(3)
    const persisted = readRunState(tempDir)
    expect(persisted.activeGate?.matrixIndex).toBe(3)

    waiter.resolve({ stepId: 'step-clarify', action: 'pass' })
    await p
  })
})

describe('executeHumanReviewBeforeStepGuardrail fallback prompt and feedback', () => {
  it('handles guardrail without prompt and whitespace-only feedback', async () => {
    const snapshot = makeSnapshot()
    writeRunStateAtomic(tempDir, snapshot)
    const { step, ctx } = makeContext(snapshot)
    const logStore = createLogStore(tempDir)
    const waiter = createGateWaiter()

    const guardrail: Guardrail = {
      __kind: 'guardrail',
      type: 'human_review',
      execute: async () => ({ status: 'pass' }),
    }

    const p = executeHumanReviewBeforeStepGuardrail(
      {
        step,
        ctx,
        snapshot,
        runDir: tempDir,
        gateWaiter: waiter,
      },
      guardrail,
      0,
      logStore,
    )
    await new Promise(r => setTimeout(r, 10))

    const activeGate = waiter.getActiveGate()
    expect(activeGate?.prompt).toBe('')

    waiter.resolve({ stepId: 'step-clarify', action: 'pass', feedback: '   ' })
    const res = await p
    expect(res.verdict.status).toBe('pass')
    expect(res.verdict.body).toBe('')
  })
})
