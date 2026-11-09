import type { Guardrail, GuardrailVerdict } from '../../types/guardrail.js'
import type { StepConfig } from '../../types/harness.js'
import type { RunStateSnapshot } from '../../types/state.js'
import type { GateWaiter } from '../gate-waiter.js'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { GuardrailMaxRetriesExceededError } from '../../errors/guardrail-max-retries-exceeded-error.js'
import { readLedgerEvents } from '../../persistence/ledger-writer.js'
import { readRunState, writeRunStateAtomic } from '../../persistence/state-store.js'
import { createGateWaiter } from '../gate-waiter.js'
import { runAfterStepGuardrails } from '../guardrail-executor.js'

async function waitForWaiter(waiter: GateWaiter): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (waiter.isWaiting()) {
      return
    }
    await new Promise(r => setTimeout(r, 5))
  }
  throw new Error('Timeout waiting for waiter')
}

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'guardrail-esc-test-'))
}

function makeInitialSnapshot(runDir: string): RunStateSnapshot {
  const snapshot: RunStateSnapshot = {
    schemaVersion: 1,
    runId: 'r-esc-1',
    harnessName: 'test-harness',
    status: 'running',
    activeStepId: 'step-1',
    steps: {},
    updatedAt: new Date().toISOString(),
  }
  writeRunStateAtomic(runDir, snapshot)
  return snapshot
}

function makeGuardrail(
  verdict: GuardrailVerdict,
  options?: { maxRetries?: number, onMaxRetriesExceeded?: 'abort' | 'prompt_user' },
): Guardrail {
  return {
    __kind: 'guardrail',
    type: 'fn',
    maxRetries: options?.maxRetries,
    onMaxRetriesExceeded: options?.onMaxRetriesExceeded,
    execute: async () => verdict,
  }
}

const fakeAgent = {
  __kind: 'agent' as const,
  mode: 'workspace-write' as const,
  prompt: 'do coding',
  executeTurn: async () => ({ output: {}, sessionId: 's-1' }),
}

function makeStepContext(runId: string) {
  return {
    runId,
    environments: {},
    steps: {},
    step: { id: 'step-1', output: null as any, attempt: 1 },
    matrix: undefined,
    artifacts: {} as any,
  }
}

describe('runAfterStepGuardrails escalation with force pass', () => {
  it('pauses and overrides failed verdict to pass when resolved with pass', async () => {
    const runDir = makeTempDir()
    try {
      const snapshot = makeInitialSnapshot(runDir)
      const waiter = createGateWaiter()
      const rail = makeGuardrail({ status: 'fail', body: 'rail failed' }, { maxRetries: 0, onMaxRetriesExceeded: 'prompt_user' })
      const step: StepConfig = {
        id: 'step-1',
        afterStep: [rail],
        run: fakeAgent,
      }
      const ctx = makeStepContext(snapshot.runId)

      const p = runAfterStepGuardrails({
        step,
        ctx,
        snapshot,
        runDir,
        attempt: 1,
        sessionId: 's-1',
        maxTotalTurns: 3,
        initialPrompt: 'Do task',
        gateWaiter: waiter,
      })

      await waitForWaiter(waiter)
      expect(readRunState(runDir).status).toBe('waiting_for_gate')
      expect(readRunState(runDir).activeGate?.gateType).toBe('max_retries_exceeded')

      waiter.resolve({ stepId: 'step-1', action: 'pass', feedback: 'Override to pass' })
      await expect(p).resolves.toBeUndefined()

      const ledger = readLedgerEvents(runDir)
      expect(ledger.map(e => e.eventType)).toContain('guardrail.passed')
    }
    finally {
      fs.rmSync(runDir, { recursive: true, force: true })
    }
  })
})

describe('runAfterStepGuardrails escalation with force skip', () => {
  it('pauses and overrides failed verdict to skip when resolved with skip', async () => {
    const runDir = makeTempDir()
    try {
      const snapshot = makeInitialSnapshot(runDir)
      const waiter = createGateWaiter()
      const rail = makeGuardrail({ status: 'fail' }, { maxRetries: 0, onMaxRetriesExceeded: 'prompt_user' })
      const step: StepConfig = {
        id: 'step-1',
        afterStep: [rail],
        run: fakeAgent,
      }
      const ctx = makeStepContext(snapshot.runId)

      const p = runAfterStepGuardrails({
        step,
        ctx,
        snapshot,
        runDir,
        attempt: 1,
        sessionId: 's-1',
        maxTotalTurns: 3,
        initialPrompt: 'Do task',
        gateWaiter: waiter,
      })

      await waitForWaiter(waiter)
      waiter.resolve({ stepId: 'step-1', action: 'skip' })
      await expect(p).resolves.toBeUndefined()

      const ledger = readLedgerEvents(runDir)
      expect(ledger.map(e => e.eventType)).toContain('guardrail.skipped')
    }
    finally {
      fs.rmSync(runDir, { recursive: true, force: true })
    }
  })
})

describe('runAfterStepGuardrails escalation with abort', () => {
  it('throws GuardrailMaxRetriesExceededError when escalation is aborted', async () => {
    const runDir = makeTempDir()
    try {
      const snapshot = makeInitialSnapshot(runDir)
      const waiter = createGateWaiter()
      const rail = makeGuardrail({ status: 'fail' }, { maxRetries: 0, onMaxRetriesExceeded: 'prompt_user' })
      const step: StepConfig = {
        id: 'step-1',
        afterStep: [rail],
        run: fakeAgent,
      }
      const ctx = makeStepContext(snapshot.runId)

      const p = runAfterStepGuardrails({
        step,
        ctx,
        snapshot,
        runDir,
        attempt: 1,
        sessionId: 's-1',
        maxTotalTurns: 3,
        initialPrompt: 'Do task',
        gateWaiter: waiter,
      })

      await waitForWaiter(waiter)
      waiter.resolve({ stepId: 'step-1', action: 'abort' })
      await expect(p).rejects.toThrow(GuardrailMaxRetriesExceededError)
    }
    finally {
      fs.rmSync(runDir, { recursive: true, force: true })
    }
  })
})

describe('runAfterStepGuardrails escalation chain advancement', () => {
  it('advances to next guardrail in chain when earlier guardrail is force passed', async () => {
    const runDir = makeTempDir()
    try {
      const snapshot = makeInitialSnapshot(runDir)
      const waiter = createGateWaiter()
      let secondRailRan = false
      const rail1 = makeGuardrail({ status: 'fail' }, { maxRetries: 0, onMaxRetriesExceeded: 'prompt_user' })
      const rail2: Guardrail = {
        __kind: 'guardrail',
        type: 'fn',
        execute: async () => {
          secondRailRan = true
          return { status: 'pass' }
        },
      }
      const step: StepConfig = {
        id: 'step-1',
        afterStep: [rail1, rail2],
        run: fakeAgent,
      }
      const ctx = makeStepContext(snapshot.runId)

      const p = runAfterStepGuardrails({
        step,
        ctx,
        snapshot,
        runDir,
        attempt: 1,
        sessionId: 's-1',
        maxTotalTurns: 3,
        initialPrompt: 'Do task',
        gateWaiter: waiter,
      })

      await waitForWaiter(waiter)
      expect(secondRailRan).toBe(false)
      waiter.resolve({ stepId: 'step-1', action: 'pass' })
      await expect(p).resolves.toBeUndefined()
      expect(secondRailRan).toBe(true)
    }
    finally {
      fs.rmSync(runDir, { recursive: true, force: true })
    }
  })
})
