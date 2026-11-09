import type { Guardrail } from '../../types/guardrail.js'
import type { StepConfig } from '../../types/harness.js'
import type { RunStateSnapshot } from '../../types/state.js'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readLedgerEvents } from '../../persistence/ledger-writer.js'
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
    step: { id: 'step-review', output: null as any, attempt: 1 },
    matrix: undefined,
    artifacts: {} as any,
  }
  return { step, ctx }
}

function makeSnapshot(): RunStateSnapshot {
  return {
    schemaVersion: 1,
    runId: 'r-hr-after-exec',
    harnessName: 'test-harness',
    status: 'running',
    activeStepId: 'step-review',
    steps: {},
    updatedAt: new Date().toISOString(),
  }
}

function setupTest(tempDir: string) {
  const snapshot = makeSnapshot()
  writeRunStateAtomic(tempDir, snapshot)
  const { step, ctx } = makeContext(snapshot)
  return { snapshot, step, ctx }
}

let tempDir: string

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-hr-after-exec-'))
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

describe('executeHumanReviewAfterStepGuardrail preconditions', () => {
  it('throws an error if gateWaiter is missing', async () => {
    const { snapshot, step, ctx } = setupTest(tempDir)
    const guardrail: Guardrail = {
      __kind: 'guardrail',
      type: 'human_review',
      execute: async () => ({ status: 'pass' }),
    }

    await expect(
      executeHumanReviewAfterStepGuardrail(
        {
          step,
          ctx,
          snapshot,
          runDir: tempDir,
          attempt: 1,
          maxTotalTurns: 3,
          initialPrompt: 'Initial',
        },
        guardrail,
        0,
      ),
    ).rejects.toThrow('GateWaiter is required to execute human_review guardrail')
  })
})

describe('executeHumanReviewAfterStepGuardrail pass with feedback', () => {
  it('transitions state to waiting_for_gate, emits gate.waiting, and resolves on pass with feedback', async () => {
    const { snapshot, step, ctx } = setupTest(tempDir)
    ctx.step.output = { title: 'Test Feature', score: 95 }
    const waiter = createGateWaiter()
    const guardrail: Guardrail = {
      __kind: 'guardrail',
      type: 'human_review',
      prompt: (c: any) => `Review ${c.step.id}: ${c.step.output.title}`,
      execute: async () => ({ status: 'pass' }),
    } as any

    const execPromise = executeHumanReviewAfterStepGuardrail(
      {
        step,
        ctx,
        snapshot,
        runDir: tempDir,
        attempt: 1,
        maxTotalTurns: 3,
        initialPrompt: 'Initial',
        gateWaiter: waiter,
      },
      guardrail,
      0,
    )

    await new Promise(r => setTimeout(r, 10))
    const statusSnapshot = readRunState(tempDir)
    expect(statusSnapshot.status).toBe('waiting_for_gate')
    expect(statusSnapshot.activeGate).toEqual({
      stepId: 'step-review',
      phase: 'afterStep',
      guardrailIndex: 0,
      gateType: 'human_review',
      prompt: 'Review step-review: Test Feature',
      createdAt: expect.any(String),
    })

    const events = readLedgerEvents(tempDir)
    expect(events.some(e => e.eventType === 'gate.waiting')).toBe(true)

    waiter.resolve({
      stepId: 'step-review',
      guardrailIndex: 0,
      action: 'pass',
      feedback: 'Approved by lead',
    })

    const verdict = await execPromise
    expect(verdict.status).toBe('pass')
    expect(verdict.body).toBe('Approved by lead')
  })
})

describe('executeHumanReviewAfterStepGuardrail pass without feedback', () => {
  it('resolves on pass without feedback and uses resolved prompt as body', async () => {
    const { snapshot, step, ctx } = setupTest(tempDir)
    const waiter = createGateWaiter()
    const guardrail = {
      __kind: 'guardrail' as const,
      type: 'human_review' as const,
      prompt: 'Static review prompt',
      execute: async () => ({ status: 'pass' as const }),
    }

    const execPromise = executeHumanReviewAfterStepGuardrail(
      {
        step,
        ctx,
        snapshot,
        runDir: tempDir,
        attempt: 1,
        maxTotalTurns: 3,
        initialPrompt: 'Initial',
        gateWaiter: waiter,
      },
      guardrail,
      0,
    )

    await new Promise(r => setTimeout(r, 10))
    waiter.resolve({
      stepId: 'step-review',
      guardrailIndex: 0,
      action: 'pass',
    })

    const verdict = await execPromise
    expect(verdict.status).toBe('pass')
    expect(verdict.body).toBe('Static review prompt')
  })
})
