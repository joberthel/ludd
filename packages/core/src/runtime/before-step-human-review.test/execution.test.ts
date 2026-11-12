import type { Guardrail } from '../../types/guardrail.js'
import type { StepConfig } from '../../types/harness.js'
import type { RunStateSnapshot } from '../../types/state.js'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createLogStore } from '../../mcp/log-store.js'
import { readLedgerEvents } from '../../persistence/ledger-writer.js'
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
    workflowName: 'test-harness',
    status: 'running',
    activeStepId: 'step-clarify',
    steps: {},
    updatedAt: new Date().toISOString(),
  }
}

function setupHumanReviewTest(tempDir: string) {
  const snapshot = makeSnapshot()
  writeRunStateAtomic(tempDir, snapshot)
  const { step, ctx } = makeContext(snapshot)
  const logStore = createLogStore(tempDir)
  return { snapshot, step, ctx, logStore }
}

let tempDir: string

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-hr-exec-test-'))
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

describe('executeHumanReviewBeforeStepGuardrail preconditions', () => {
  it('throws an error if gateWaiter is missing', async () => {
    const { snapshot, step, ctx, logStore } = setupHumanReviewTest(tempDir)
    const guardrail: Guardrail = {
      __kind: 'guardrail',
      type: 'human_review',
      execute: async () => ({ status: 'pass' }),
    }

    await expect(
      executeHumanReviewBeforeStepGuardrail(
        { step, ctx, snapshot, runDir: tempDir },
        guardrail,
        0,
        logStore,
      ),
    ).rejects.toThrow('GateWaiter is required to execute human_review guardrail')
  })
})

describe('executeHumanReviewBeforeStepGuardrail resolution with feedback', () => {
  it('transitions state to waiting_for_gate, emits gate.waiting, and resolves on pass with feedback', async () => {
    const { snapshot, step, ctx, logStore } = setupHumanReviewTest(tempDir)
    const waiter = createGateWaiter()
    const guardrail: Guardrail = {
      __kind: 'guardrail',
      type: 'human_review',
      prompt: (c: any) => `Review step ${c.step.id}`,
      execute: async () => ({ status: 'pass' }),
    } as any

    const execPromise = executeHumanReviewBeforeStepGuardrail(
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

    expect(waiter.isWaiting()).toBe(true)
    expect(waiter.getActiveGate()?.prompt).toBe('Review step step-clarify')
    expect(readRunState(tempDir).status).toBe('waiting_for_gate')

    waiter.resolve({
      stepId: 'step-clarify',
      guardrailIndex: 0,
      action: 'pass',
      feedback: 'Approved with specific guidelines',
    })

    const result = await execPromise
    expect(result.verdict.status).toBe('pass')
    expect(result.feedback).toBe('Approved with specific guidelines')
    expect(readLedgerEvents(tempDir).map(e => e.eventType)).toEqual(['gate.waiting', 'guardrail.passed'])
  })
})

describe('executeHumanReviewBeforeStepGuardrail resolution without feedback', () => {
  it('handles pass without feedback using the resolved prompt as body', async () => {
    const { snapshot, step, ctx, logStore } = setupHumanReviewTest(tempDir)
    const waiter = createGateWaiter()
    const guardrail: Guardrail = {
      __kind: 'guardrail',
      type: 'human_review',
      prompt: 'Static review prompt',
      execute: async () => ({ status: 'pass' }),
    } as any

    const execPromise = executeHumanReviewBeforeStepGuardrail(
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

    waiter.resolve({ stepId: 'step-clarify', action: 'pass' })
    const result = await execPromise
    expect(result.verdict.status).toBe('pass')
    expect(result.verdict.body).toBe('Static review prompt')
  })
})
