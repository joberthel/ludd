import type { Guardrail, GuardrailVerdict } from '../../types/guardrail.js'
import type { StepConfig } from '../../types/harness.js'
import type { RunStateSnapshot } from '../../types/state.js'
import type { GateWaiter } from '../gate-waiter.js'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GuardrailMaxRetriesExceededError } from '../../errors/guardrail-max-retries-exceeded-error.js'
import { MaxTotalTurnsExceededError } from '../../errors/max-total-turns-exceeded-error.js'
import { readLedgerEvents } from '../../persistence/ledger-writer.js'
import { readRunState, writeRunStateAtomic } from '../../persistence/state-store.js'
import { handleGuardrailEscalation } from '../escalation-manager.js'
import { createGateWaiter } from '../gate-waiter.js'

async function waitForWaiter(waiter: GateWaiter): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (waiter.isWaiting()) {
      return
    }
    await new Promise(r => setTimeout(r, 5))
  }
  throw new Error('Timeout waiting for waiter')
}

function makeContext(snapshot: RunStateSnapshot, matrixIndex?: number) {
  const step: StepConfig = {
    id: 'step-exec',
    onMaxRetriesExceeded: 'prompt_user',
    run: async () => ({}),
  }
  const ctx = {
    runId: snapshot.runId,
    environments: {},
    steps: {},
    step: { id: 'step-exec', output: null as any, attempt: 2 },
    matrix: matrixIndex !== undefined
      ? { index: matrixIndex, total: 3, item: 'item-1' }
      : undefined,
    artifacts: {} as any,
  }
  return { step, ctx }
}

function makeSnapshot(): RunStateSnapshot {
  return {
    schemaVersion: 1,
    runId: 'r-esc-exec',
    harnessName: 'test-harness',
    workflowName: 'test-harness',
    status: 'running',
    activeStepId: 'step-exec',
    steps: {},
    updatedAt: new Date().toISOString(),
  }
}

let tempDir: string

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-esc-exec-'))
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

async function callEscalation(
  tempDir: string,
  snapshot: RunStateSnapshot,
  step: StepConfig,
  ctx: any,
  guardrail: Guardrail,
  reason: 'guardrail_max_retries' | 'max_total_turns',
  waiter?: any,
) {
  const verdict: GuardrailVerdict = { status: 'fail', body: 'fail-abort' }
  return handleGuardrailEscalation(
    {
      step,
      ctx,
      snapshot,
      runDir: tempDir,
      attempt: 2,
      maxTotalTurns: 3,
      initialPrompt: 'Initial prompt',
      gateWaiter: waiter,
    },
    0,
    guardrail,
    verdict,
    reason,
  )
}

describe('handleGuardrailEscalation preconditions', () => {
  it('throws an error if gateWaiter is missing when policy is prompt_user', async () => {
    const snapshot = makeSnapshot()
    writeRunStateAtomic(tempDir, snapshot)
    const { step, ctx } = makeContext(snapshot)
    const guardrail: Guardrail = {
      __kind: 'guardrail',
      type: 'exec',
      execute: async () => ({ status: 'fail' }),
    }

    await expect(
      callEscalation(tempDir, snapshot, step, ctx, guardrail, 'guardrail_max_retries', undefined),
    ).rejects.toThrow('GateWaiter is required for onMaxRetriesExceeded: prompt_user')
  })
})

describe('handleGuardrailEscalation abort policy', () => {
  it('throws immediately when policy is abort for guardrail_max_retries (defined and undefined maxRetries)', async () => {
    const snapshot = makeSnapshot()
    writeRunStateAtomic(tempDir, snapshot)
    const { step, ctx } = makeContext(snapshot)
    step.onMaxRetriesExceeded = 'abort'
    const waiter = createGateWaiter()
    const railWithoutMax: Guardrail = {
      __kind: 'guardrail',
      type: 'exec',
      execute: async () => ({ status: 'fail' }),
    }
    const railWithMax: Guardrail = {
      __kind: 'guardrail',
      type: 'exec',
      maxRetries: 2,
      execute: async () => ({ status: 'fail' }),
    }

    await expect(
      callEscalation(tempDir, snapshot, step, ctx, railWithoutMax, 'guardrail_max_retries', waiter),
    ).rejects.toThrow(GuardrailMaxRetriesExceededError)

    await expect(
      callEscalation(tempDir, snapshot, step, ctx, railWithMax, 'guardrail_max_retries', waiter),
    ).rejects.toThrow(GuardrailMaxRetriesExceededError)
  })

  it('throws immediately when policy is abort for max_total_turns', async () => {
    const snapshot = makeSnapshot()
    writeRunStateAtomic(tempDir, snapshot)
    const { step, ctx } = makeContext(snapshot)
    step.onMaxRetriesExceeded = 'abort'
    const guardrail: Guardrail = {
      __kind: 'guardrail',
      type: 'exec',
      execute: async () => ({ status: 'fail' }),
    }
    const waiter = createGateWaiter()

    await expect(
      callEscalation(tempDir, snapshot, step, ctx, guardrail, 'max_total_turns', waiter),
    ).rejects.toThrow(MaxTotalTurnsExceededError)
  })
})

function assertActiveGateState(state: ReturnType<typeof readRunState>): void {
  expect(state.status).toBe('waiting_for_gate')
  expect(state.activeGate).toEqual({
    stepId: 'step-exec',
    matrixIndex: 2,
    phase: 'afterStep',
    guardrailIndex: 1,
    gateType: 'max_retries_exceeded',
    prompt: expect.stringContaining('Guardrail #1 in step "step-exec" exceeded maxRetries.'),
    createdAt: expect.any(String),
  })
}

function assertLedgerEvents(runDir: string): void {
  const ledger = readLedgerEvents(runDir)
  const waitingEvent = ledger.find(e => e.eventType === 'gate.waiting')
  expect(waitingEvent).toBeDefined()
  expect(waitingEvent?.matrixIndex).toBe(2)
  const passedEvent = ledger.find(e => e.eventType === 'guardrail.passed')
  expect(passedEvent).toBeDefined()
  expect(passedEvent?.matrixIndex).toBe(2)
}

describe('handleGuardrailEscalation state and ledger emissions', () => {
  it('updates state snapshot to waiting_for_gate and includes matrixIndex', async () => {
    const snapshot = makeSnapshot()
    writeRunStateAtomic(tempDir, snapshot)
    const { step, ctx } = makeContext(snapshot, 2)
    const guardrail: Guardrail = {
      __kind: 'guardrail',
      type: 'exec',
      execute: async () => ({ status: 'fail' }),
    }
    const verdict: GuardrailVerdict = { status: 'fail', body: 'err' }
    const waiter = createGateWaiter()

    const escalationPromise = handleGuardrailEscalation(
      {
        step,
        ctx,
        snapshot,
        runDir: tempDir,
        attempt: 2,
        maxTotalTurns: 3,
        initialPrompt: 'Initial prompt',
        gateWaiter: waiter,
      },
      1,
      guardrail,
      verdict,
      'guardrail_max_retries',
    )

    await waitForWaiter(waiter)
    assertActiveGateState(readRunState(tempDir))

    waiter.resolve({ stepId: 'step-exec', action: 'pass' })
    const result = await escalationPromise
    expect(result.status).toBe('pass')
    assertLedgerEvents(tempDir)
  })
})
