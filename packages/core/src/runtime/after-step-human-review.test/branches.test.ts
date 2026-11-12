import type { Guardrail } from '../../types/guardrail.js'
import type { StepConfig } from '../../types/harness.js'
import type { RunStateSnapshot } from '../../types/state.js'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readRunState, writeRunStateAtomic } from '../../persistence/state-store.js'
import { executeHumanReviewAfterStepGuardrail } from '../after-step-human-review.js'
import { createGateWaiter } from '../gate-waiter.js'

function makeContext(snapshot: RunStateSnapshot) {
  const step: StepConfig = {
    id: 'step-review',
    run: async () => ({}),
  }
  const ctx = {
    runId: snapshot.runId,
    environments: {},
    steps: {},
    step: { id: 'step-review', output: null, attempt: 1 },
    matrix: undefined as { index: number, total: number, item: unknown } | undefined,
    artifacts: {} as any,
  }
  return { step, ctx }
}

function makeSnapshot(): RunStateSnapshot {
  return {
    schemaVersion: 1,
    runId: 'r-hr-after-branches',
    harnessName: 'test-harness',
    workflowName: 'test-harness',
    status: 'running',
    activeStepId: 'step-review',
    steps: {},
    updatedAt: new Date().toISOString(),
  }
}

let tempDir: string

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-hr-after-branches-'))
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

describe('executeHumanReviewAfterStepGuardrail matrix context', () => {
  it('records matrixIndex in activeGate when step is executing in matrix context', async () => {
    const snapshot = makeSnapshot()
    writeRunStateAtomic(tempDir, snapshot)
    const { step, ctx } = makeContext(snapshot)
    ctx.matrix = {
      index: 2,
      total: 4,
      item: { id: 'slice-2' },
    }
    const waiter = createGateWaiter()

    const guardrail = {
      __kind: 'guardrail' as const,
      type: 'human_review' as const,
      prompt: 'Review slice 2',
      execute: async () => ({ status: 'pass' as const }),
    }

    const p = executeHumanReviewAfterStepGuardrail(
      {
        step,
        ctx,
        snapshot,
        runDir: tempDir,
        attempt: 1,
        maxTotalTurns: 3,
        initialPrompt: 'Initial prompt',
        gateWaiter: waiter,
      },
      guardrail,
      0,
    )
    await new Promise(r => setTimeout(r, 10))

    const activeGate = waiter.getActiveGate()
    expect(activeGate?.matrixIndex).toBe(2)
    const persisted = readRunState(tempDir)
    expect(persisted.activeGate?.matrixIndex).toBe(2)

    waiter.resolve({ stepId: 'step-review', action: 'pass' })
    await p
  })
})

describe('executeHumanReviewAfterStepGuardrail fallback prompt and feedback', () => {
  it('handles guardrail without prompt and whitespace-only feedback', async () => {
    const snapshot = makeSnapshot()
    writeRunStateAtomic(tempDir, snapshot)
    const { step, ctx } = makeContext(snapshot)
    const waiter = createGateWaiter()

    const guardrailWithoutPrompt: Guardrail = {
      __kind: 'guardrail',
      type: 'human_review',
      execute: async () => ({ status: 'pass' }),
    }

    const p = executeHumanReviewAfterStepGuardrail(
      {
        step,
        ctx,
        snapshot,
        runDir: tempDir,
        attempt: 1,
        maxTotalTurns: 3,
        initialPrompt: 'Initial prompt',
        gateWaiter: waiter,
      },
      guardrailWithoutPrompt,
      0,
    )
    await new Promise(r => setTimeout(r, 10))

    waiter.resolve({ stepId: 'step-review', action: 'pass', feedback: '   ' })
    const res = await p
    expect(res.status).toBe('pass')
    expect(res.body).toBe('')
  })
})
