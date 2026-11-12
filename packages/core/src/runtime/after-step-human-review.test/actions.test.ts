import type { Guardrail } from '../../types/guardrail.js'
import type { StepConfig } from '../../types/harness.js'
import type { GateAction } from '../../types/ipc.js'
import type { RunStateSnapshot } from '../../types/state.js'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { writeRunStateAtomic } from '../../persistence/state-store.js'
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
    matrix: undefined,
    artifacts: {} as any,
  }
  return { step, ctx }
}

function makeSnapshot(): RunStateSnapshot {
  return {
    schemaVersion: 1,
    runId: 'r-hr-after-actions',
    harnessName: 'test-harness',
    workflowName: 'test-harness',
    status: 'running',
    activeStepId: 'step-review',
    steps: {},
    updatedAt: new Date().toISOString(),
  }
}

async function runWithResolution(tempDir: string, action: GateAction, feedback?: string) {
  const snapshot = makeSnapshot()
  writeRunStateAtomic(tempDir, snapshot)
  const { step, ctx } = makeContext(snapshot)
  const guardrail: Guardrail = {
    __kind: 'guardrail',
    type: 'human_review',
    execute: async () => ({ status: 'pass' }),
  }
  const waiter = createGateWaiter()
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
  waiter.resolve({ stepId: 'step-review', action, feedback })
  return p
}

let tempDir: string

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-hr-after-actions-'))
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

describe('executeHumanReviewAfterStepGuardrail skip action', () => {
  it('handles skip action with feedback', async () => {
    const res = await runWithResolution(tempDir, 'skip', 'Skipped by reviewer')
    expect(res.status).toBe('skip')
    expect(res.body).toBe('Skipped by reviewer')
  })

  it('handles skip action without feedback', async () => {
    const res = await runWithResolution(tempDir, 'skip')
    expect(res.status).toBe('skip')
    expect(res.body).toBe('')
  })
})

describe('executeHumanReviewAfterStepGuardrail fail action', () => {
  it('handles fail action with feedback', async () => {
    const res = await runWithResolution(tempDir, 'fail', 'Failed review')
    expect(res.status).toBe('fail')
    expect(res.body).toBe('Failed review')
  })

  it('handles fail action without feedback', async () => {
    const res = await runWithResolution(tempDir, 'fail')
    expect(res.status).toBe('fail')
    expect(res.body).toBe('')
  })
})

describe('executeHumanReviewAfterStepGuardrail abort action', () => {
  it('throws an error when resolution action is abort with feedback', async () => {
    await expect(
      runWithResolution(tempDir, 'abort', 'Operator aborted'),
    ).rejects.toThrow('Gate resolution aborted: Operator aborted')
  })

  it('throws an error when resolution action is abort without feedback', async () => {
    await expect(
      runWithResolution(tempDir, 'abort'),
    ).rejects.toThrow('Gate resolution aborted')
  })
})
