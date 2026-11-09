import type { Guardrail } from '../../types/guardrail.js'
import type { StepConfig } from '../../types/harness.js'
import type { GateAction } from '../../types/ipc.js'
import type { RunStateSnapshot } from '../../types/state.js'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createLogStore } from '../../mcp/log-store.js'
import { writeRunStateAtomic } from '../../persistence/state-store.js'
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
    matrix: undefined,
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

async function runWithResolution(tempDir: string, action: GateAction, feedback?: string) {
  const snapshot = makeSnapshot()
  writeRunStateAtomic(tempDir, snapshot)
  const { step, ctx } = makeContext(snapshot)
  const logStore = createLogStore(tempDir)
  const guardrail: Guardrail = {
    __kind: 'guardrail',
    type: 'human_review',
    execute: async () => ({ status: 'pass' }),
  }
  const waiter = createGateWaiter()
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
  waiter.resolve({ stepId: 'step-clarify', action, feedback })
  return p
}

let tempDir: string

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-hr-actions-test-'))
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

describe('executeHumanReviewBeforeStepGuardrail skip action', () => {
  it('handles skip action with feedback', async () => {
    const res = await runWithResolution(tempDir, 'skip', 'Skipped by reviewer')
    expect(res.verdict.status).toBe('skip')
    expect(res.verdict.body).toBe('Skipped by reviewer')
  })

  it('handles skip action without feedback', async () => {
    const res = await runWithResolution(tempDir, 'skip')
    expect(res.verdict.status).toBe('skip')
    expect(res.verdict.body).toBe('')
  })
})

describe('executeHumanReviewBeforeStepGuardrail fail action', () => {
  it('handles fail action with feedback', async () => {
    const res = await runWithResolution(tempDir, 'fail', 'Failed validation')
    expect(res.verdict.status).toBe('fail')
    expect(res.verdict.body).toBe('Failed validation')
  })

  it('handles fail action without feedback', async () => {
    const res = await runWithResolution(tempDir, 'fail')
    expect(res.verdict.status).toBe('fail')
    expect(res.verdict.body).toBe('')
  })
})

describe('executeHumanReviewBeforeStepGuardrail abort action', () => {
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
