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
import { GuardrailRetrySignal } from '../guardrail-retry-signal.js'

async function waitForWaiter(waiter: GateWaiter): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (waiter.isWaiting())
      return
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
    runId: 'r-esc-retry',
    harnessName: 'test-harness',
    status: 'running',
    activeStepId: 'step-esc',
    steps: {},
    updatedAt: new Date().toISOString(),
  }
}

async function startEscalation(
  tempDir: string,
  waiter: GateWaiter,
  verdict: GuardrailVerdict,
  options?: { sessionId?: string, initialExtra?: boolean },
) {
  const snapshot = makeSnapshot()
  if (options?.initialExtra) {
    snapshot.grantedExtraRetries = { 'step-esc:0': 1 }
    snapshot.grantedExtraTurns = { 'step-esc': 1 }
  }
  writeRunStateAtomic(tempDir, snapshot)
  const { step, ctx } = makeContext(snapshot)
  const guardrail: Guardrail = {
    __kind: 'guardrail',
    type: 'exec',
    maxRetries: 1,
    execute: async () => verdict,
  }

  const promise = handleGuardrailEscalation(
    {
      step,
      ctx,
      snapshot,
      runDir: tempDir,
      attempt: 2,
      sessionId: options?.sessionId,
      maxTotalTurns: 5,
      initialPrompt: 'Initial prompt',
      gateWaiter: waiter,
    },
    0,
    guardrail,
    verdict,
    'guardrail_max_retries',
  )
  return { promise, ctx }
}

let tempDir: string

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-esc-retry-'))
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

describe('handleGuardrailEscalation action: retry budget extension', () => {
  it('throws GuardrailRetrySignal with hint and updates snapshot with addRetries', async () => {
    const waiter = createGateWaiter()
    const { promise, ctx } = await startEscalation(
      tempDir,
      waiter,
      { status: 'fail', body: 'original-fail', logKey: 'key-1' },
      { sessionId: 's-1' },
    )
    await waitForWaiter(waiter)

    waiter.resolve({
      stepId: 'step-esc',
      guardrailIndex: 0,
      action: 'retry',
      addRetries: 2,
      feedback: 'Fix the clock',
    })

    const signal = await promise.catch(err => err) as GuardrailRetrySignal
    expect(signal).toBeInstanceOf(GuardrailRetrySignal)
    expect(signal.prompt).toContain('Fix the clock')
    expect(signal.prompt).toContain('Detailed failure log has been offloaded to MCP logKey "key-1"')
    expect(ctx.step.attempt).toBe(3)

    const diskState = readRunState(tempDir)
    expect(diskState.grantedExtraRetries?.['step-esc:0']).toBe(2)
    expect(diskState.grantedExtraTurns?.['step-esc']).toBe(2)

    const events = readLedgerEvents(tempDir)
    const retryEvent = events.find(e => e.eventType === 'step.retry')
    expect((retryEvent?.payload.issues as any).feedback).toBe('Fix the clock')
  })

  it('defaults addRetries to 1 when omitted and handles empty feedback', async () => {
    const waiter = createGateWaiter()
    const { promise } = await startEscalation(
      tempDir,
      waiter,
      { status: 'fail', body: 'err' },
      { initialExtra: true },
    )
    await waitForWaiter(waiter)
    waiter.resolve({ stepId: 'step-esc', action: 'retry' })

    await expect(promise).rejects.toThrow(GuardrailRetrySignal)
    const diskState = readRunState(tempDir)
    expect(diskState.grantedExtraRetries?.['step-esc:0']).toBe(2)
    expect(diskState.grantedExtraTurns?.['step-esc']).toBe(2)
  })
})

describe('handleGuardrailEscalation action: retry validation and error cases', () => {
  it('rejects invalid addRetries <= 0', async () => {
    const waiter = createGateWaiter()
    const { promise } = await startEscalation(tempDir, waiter, { status: 'fail' })
    await waitForWaiter(waiter)
    waiter.resolve({ stepId: 'step-esc', action: 'retry', addRetries: 0 })

    await expect(promise).rejects.toThrow('Invalid addRetries: expected integer >= 1, received 0')
  })

  it('throws with effective maxRetries and turns when policy is abort', async () => {
    const snapshot = makeSnapshot()
    snapshot.grantedExtraRetries = { 'step-abort:0': 3 }
    snapshot.grantedExtraTurns = { 'step-abort': 4 }
    writeRunStateAtomic(tempDir, snapshot)
    const step: StepConfig = {
      id: 'step-abort',
      onMaxRetriesExceeded: 'abort',
      run: async () => ({}),
    }
    const ctx = {
      runId: snapshot.runId,
      environments: {},
      steps: {},
      step: { id: 'step-abort', output: null as any, attempt: 1 },
      matrix: undefined,
      artifacts: {} as any,
    }
    const guardrail: Guardrail = {
      __kind: 'guardrail',
      type: 'fn',
      maxRetries: 2,
      execute: async () => ({ status: 'fail' }),
    }

    const callEsc = async (reason: 'guardrail_max_retries' | 'max_total_turns') =>
      handleGuardrailEscalation({
        step,
        ctx,
        snapshot,
        runDir: tempDir,
        attempt: 1,
        maxTotalTurns: 5,
        initialPrompt: '',
      }, 0, guardrail, { status: 'fail' }, reason)

    await expect(callEsc('guardrail_max_retries')).rejects.toThrow(GuardrailMaxRetriesExceededError)
    await expect(callEsc('max_total_turns')).rejects.toThrow(MaxTotalTurnsExceededError)
  })
})
