import type { Guardrail, GuardrailVerdict } from '../../types/guardrail.js'
import type { StepConfig } from '../../types/harness.js'
import type { GateAction } from '../../types/ipc.js'
import type { RunStateSnapshot } from '../../types/state.js'
import type { EscalationReason } from '../escalation-manager.js'
import type { GateWaiter } from '../gate-waiter.js'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GuardrailMaxRetriesExceededError } from '../../errors/guardrail-max-retries-exceeded-error.js'
import { MaxTotalTurnsExceededError } from '../../errors/max-total-turns-exceeded-error.js'
import { writeRunStateAtomic } from '../../persistence/state-store.js'
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

function makeContext(snapshot: RunStateSnapshot) {
  const step: StepConfig = {
    id: 'step-esc',
    onMaxRetriesExceeded: 'prompt_user',
    run: async () => ({}),
  }
  const ctx = {
    runId: snapshot.runId,
    environments: {},
    steps: {},
    step: { id: 'step-esc', output: null as any, attempt: 2 },
    matrix: undefined,
    artifacts: {} as any,
  }
  return { step, ctx }
}

function makeSnapshot(): RunStateSnapshot {
  return {
    schemaVersion: 1,
    runId: 'r-esc-actions',
    harnessName: 'test-harness',
    status: 'running',
    activeStepId: 'step-esc',
    steps: {},
    updatedAt: new Date().toISOString(),
  }
}

async function runEscalationWithResolution(
  tempDir: string,
  action: GateAction,
  reason: EscalationReason = 'guardrail_max_retries',
  feedback?: string,
  maxRetries?: number,
) {
  const snapshot = makeSnapshot()
  writeRunStateAtomic(tempDir, snapshot)
  const { step, ctx } = makeContext(snapshot)
  const guardrail: Guardrail = {
    __kind: 'guardrail',
    type: 'exec',
    maxRetries,
    execute: async () => ({ status: 'fail', body: 'original-fail' }),
  }
  const waiter = createGateWaiter()
  const verdict: GuardrailVerdict = { status: 'fail', body: 'original-fail', logKey: 'key-1' }

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
    0,
    guardrail,
    verdict,
    reason,
  )

  await waitForWaiter(waiter)
  waiter.resolve({ stepId: 'step-esc', action, feedback })
  return escalationPromise
}

let tempDir: string

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-esc-actions-'))
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

describe('handleGuardrailEscalation pass and skip actions', () => {
  it('overrides verdict to pass with feedback', async () => {
    const res = await runEscalationWithResolution(tempDir, 'pass', 'guardrail_max_retries', 'Force passed by user')
    expect(res.status).toBe('pass')
    expect(res.body).toBe('Force passed by user')
    expect(res.logKey).toBe('key-1')
  })

  it('overrides verdict to pass without feedback and keeps original body', async () => {
    const res = await runEscalationWithResolution(tempDir, 'pass', 'guardrail_max_retries')
    expect(res.status).toBe('pass')
    expect(res.body).toBe('original-fail')
    expect(res.logKey).toBe('key-1')
  })

  it('overrides verdict to skip with feedback', async () => {
    const res = await runEscalationWithResolution(tempDir, 'skip', 'guardrail_max_retries', 'Skipped by user')
    expect(res.status).toBe('skip')
    expect(res.body).toBe('Skipped by user')
    expect(res.logKey).toBe('key-1')
  })

  it('overrides verdict to skip without feedback and keeps original body', async () => {
    const res = await runEscalationWithResolution(tempDir, 'skip', 'guardrail_max_retries')
    expect(res.status).toBe('skip')
    expect(res.body).toBe('original-fail')
    expect(res.logKey).toBe('key-1')
  })

  it('keeps original body when feedback is whitespace only', async () => {
    const res = await runEscalationWithResolution(tempDir, 'pass', 'guardrail_max_retries', '   ')
    expect(res.status).toBe('pass')
    expect(res.body).toBe('original-fail')
  })
})

describe('handleGuardrailEscalation abort and reject actions', () => {
  it('throws GuardrailMaxRetriesExceededError when aborted with defined and undefined maxRetries', async () => {
    await expect(
      runEscalationWithResolution(tempDir, 'abort', 'guardrail_max_retries', undefined, 1),
    ).rejects.toThrow(GuardrailMaxRetriesExceededError)

    await expect(
      runEscalationWithResolution(tempDir, 'abort', 'guardrail_max_retries', undefined, undefined),
    ).rejects.toThrow(GuardrailMaxRetriesExceededError)
  })

  it('throws MaxTotalTurnsExceededError when aborted on max_total_turns', async () => {
    await expect(
      runEscalationWithResolution(tempDir, 'abort', 'max_total_turns'),
    ).rejects.toThrow(MaxTotalTurnsExceededError)
  })

  it('throws GuardrailMaxRetriesExceededError when resolved with non-pass/skip action', async () => {
    await expect(
      runEscalationWithResolution(tempDir, 'fail', 'guardrail_max_retries'),
    ).rejects.toThrow(GuardrailMaxRetriesExceededError)
  })
})
