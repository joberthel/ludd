import type { Guardrail, GuardrailVerdict } from '../../types/guardrail.js'
import type { StepConfig } from '../../types/harness.js'
import type { RunStateSnapshot } from '../../types/state.js'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { GuardrailMaxRetriesExceededError } from '../../errors/guardrail-max-retries-exceeded-error.js'
import { MaxTotalTurnsExceededError } from '../../errors/max-total-turns-exceeded-error.js'
import { readLedgerEvents } from '../../persistence/ledger-writer.js'
import { readRunState, writeRunStateAtomic } from '../../persistence/state-store.js'
import { GuardrailRetrySignal, runAfterStepGuardrails } from '../guardrail-executor.js'

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'guardrail-retries-test-'))
}

function makeInitialSnapshot(runDir: string): RunStateSnapshot {
  const snapshot: RunStateSnapshot = {
    schemaVersion: 1,
    runId: 'r-1',
    harnessName: 'test-harness',
    workflowName: 'test-harness',
    status: 'running',
    activeStepId: 'step-1',
    steps: {},
    updatedAt: new Date().toISOString(),
  }
  writeRunStateAtomic(runDir, snapshot)
  return snapshot
}

function makeGuardrail(verdict: GuardrailVerdict, options?: { maxRetries?: number }): Guardrail {
  return {
    __kind: 'guardrail',
    type: 'fn',
    maxRetries: options?.maxRetries,
    execute: async () => verdict,
  }
}

const fakeAgent = {
  __kind: 'agent' as const,
  mode: 'workspace-write' as const,
  prompt: 'do coding',
  executeTurn: async () => ({ output: {}, sessionId: 's-1' }),
}

describe('runAfterStepGuardrails agent retry signal', () => {
  it('signals retry for agent step within maxRetries and below maxTotalTurns', async () => {
    const runDir = makeTempDir()
    try {
      const snapshot = makeInitialSnapshot(runDir)
      const step: StepConfig = {
        id: 's-1',
        afterStep: [
          makeGuardrail({ status: 'fail', body: 'test failed' }, { maxRetries: 2 }),
        ],
        run: fakeAgent,
      }
      const ctx = {
        runId: 'r-1',
        environments: {},
        steps: {},
        step: { id: 's-1', output: {}, attempt: 1 },
        matrix: undefined,
        artifacts: {} as any,
      }

      await expect(runAfterStepGuardrails({
        step,
        ctx,
        snapshot,
        runDir,
        attempt: 1,
        sessionId: 'sess-1',
        maxTotalTurns: 5,
        initialPrompt: 'do coding',
      })).rejects.toThrow(GuardrailRetrySignal)

      expect(ctx.step.attempt).toBe(2)
      expect(readRunState(runDir).activeGuardrailRetries?.['0']).toBe(1)
      expect(readLedgerEvents(runDir).some(e => e.eventType === 'step.retry')).toBe(true)
    }
    finally {
      fs.rmSync(runDir, { recursive: true, force: true })
    }
  })
})

describe('runAfterStepGuardrails anonymous session retry', () => {
  it('handles undefined sessionId when emitting step.retry', async () => {
    const runDir = makeTempDir()
    try {
      const snapshot = makeInitialSnapshot(runDir)
      const step: StepConfig = {
        id: 's-anon-session',
        afterStep: [
          makeGuardrail({ status: 'fail' }, { maxRetries: 2 }),
        ],
        run: fakeAgent,
      }
      const ctx = {
        runId: 'r-1',
        environments: {},
        steps: {},
        step: { id: 's-anon-session', output: {}, attempt: 1 },
        matrix: undefined,
        artifacts: {} as any,
      }

      await expect(runAfterStepGuardrails({
        step,
        ctx,
        snapshot,
        runDir,
        attempt: 1,
        sessionId: undefined,
        maxTotalTurns: 5,
        initialPrompt: 'do coding',
      })).rejects.toThrow(GuardrailRetrySignal)

      const events = readLedgerEvents(runDir)
      const retry = events.find(e => e.eventType === 'step.retry')
      expect(retry?.payload.sessionId).toBe('')
    }
    finally {
      fs.rmSync(runDir, { recursive: true, force: true })
    }
  })
})

describe('runAfterStepGuardrails default maxRetries', () => {
  it('defaults maxRetries to 0 when undefined on agent guardrail, throwing on first failure', async () => {
    const runDir = makeTempDir()
    try {
      const snapshot = makeInitialSnapshot(runDir)
      const step: StepConfig = {
        id: 's-no-retries',
        afterStep: [
          makeGuardrail({ status: 'fail' }),
        ],
        run: fakeAgent,
      }
      const ctx = {
        runId: 'r-1',
        environments: {},
        steps: {},
        step: { id: 's-no-retries', output: {}, attempt: 1 },
        matrix: undefined,
        artifacts: {} as any,
      }

      await expect(runAfterStepGuardrails({
        step,
        ctx,
        snapshot,
        runDir,
        attempt: 1,
        sessionId: 'sess-1',
        maxTotalTurns: 5,
        initialPrompt: 'do coding',
      })).rejects.toThrow(GuardrailMaxRetriesExceededError)
    }
    finally {
      fs.rmSync(runDir, { recursive: true, force: true })
    }
  })
})

describe('runAfterStepGuardrails maxRetries exhaustion', () => {
  it('throws GuardrailMaxRetriesExceededError when agent retries exceed guardrail maxRetries', async () => {
    const runDir = makeTempDir()
    try {
      const snapshot = makeInitialSnapshot(runDir)
      snapshot.activeGuardrailRetries = { 0: 2 }
      const step: StepConfig = {
        id: 's-1',
        afterStep: [
          makeGuardrail({ status: 'fail' }, { maxRetries: 2 }),
        ],
        run: fakeAgent,
      }
      const ctx = {
        runId: 'r-1',
        environments: {},
        steps: {},
        step: { id: 's-1', output: {}, attempt: 2 },
        matrix: undefined,
        artifacts: {} as any,
      }

      await expect(runAfterStepGuardrails({
        step,
        ctx,
        snapshot,
        runDir,
        attempt: 2,
        sessionId: 'sess-1',
        maxTotalTurns: 5,
        initialPrompt: 'do coding',
      })).rejects.toThrow(GuardrailMaxRetriesExceededError)
    }
    finally {
      fs.rmSync(runDir, { recursive: true, force: true })
    }
  })
})

describe('runAfterStepGuardrails maxTotalTurns exhaustion', () => {
  it('throws MaxTotalTurnsExceededError when attempt reaches maxTotalTurns', async () => {
    const runDir = makeTempDir()
    try {
      const snapshot = makeInitialSnapshot(runDir)
      const step: StepConfig = {
        id: 's-1',
        afterStep: [
          makeGuardrail({ status: 'fail' }, { maxRetries: 10 }),
        ],
        run: fakeAgent,
      }
      const ctx = {
        runId: 'r-1',
        environments: {},
        steps: {},
        step: { id: 's-1', output: {}, attempt: 5 },
        matrix: undefined,
        artifacts: {} as any,
      }

      await expect(runAfterStepGuardrails({
        step,
        ctx,
        snapshot,
        runDir,
        attempt: 5,
        sessionId: 'sess-1',
        maxTotalTurns: 5,
        initialPrompt: 'do coding',
      })).rejects.toThrow(MaxTotalTurnsExceededError)
    }
    finally {
      fs.rmSync(runDir, { recursive: true, force: true })
    }
  })
})

describe('runAfterStepGuardrails StepRunFactory retry', () => {
  it('signals retry for factory-created agent step when isAgent is true', async () => {
    const runDir = makeTempDir()
    try {
      const snapshot = makeInitialSnapshot(runDir)
      const step: StepConfig = {
        id: 's-factory',
        afterStep: [
          makeGuardrail({ status: 'fail', body: 'test failed' }, { maxRetries: 2 }),
        ],
        run: () => fakeAgent,
      }
      const ctx = {
        runId: 'r-1',
        environments: {},
        steps: {},
        step: { id: 's-factory', output: {}, attempt: 1 },
        matrix: undefined,
        artifacts: {} as any,
      }

      await expect(runAfterStepGuardrails({
        step,
        ctx,
        snapshot,
        runDir,
        attempt: 1,
        sessionId: 'sess-1',
        maxTotalTurns: 5,
        initialPrompt: 'do coding',
        isAgent: true,
      })).rejects.toThrow(GuardrailRetrySignal)

      expect(ctx.step.attempt).toBe(2)
      expect(readRunState(runDir).activeGuardrailRetries?.['0']).toBe(1)
    }
    finally {
      fs.rmSync(runDir, { recursive: true, force: true })
    }
  })

  it('escalates immediately for function step when isAgent is false', async () => {
    const runDir = makeTempDir()
    try {
      const snapshot = makeInitialSnapshot(runDir)
      const step: StepConfig = {
        id: 's-fn',
        afterStep: [
          makeGuardrail({ status: 'fail', body: 'test failed' }, { maxRetries: 2 }),
        ],
        run: () => ({ ok: true }),
      }
      const ctx = {
        runId: 'r-1',
        environments: {},
        steps: {},
        step: { id: 's-fn', output: {}, attempt: 1 },
        matrix: undefined,
        artifacts: {} as any,
      }

      await expect(runAfterStepGuardrails({
        step,
        ctx,
        snapshot,
        runDir,
        attempt: 1,
        sessionId: undefined,
        maxTotalTurns: 1,
        initialPrompt: '',
        isAgent: false,
      })).rejects.toThrow(GuardrailMaxRetriesExceededError)
    }
    finally {
      fs.rmSync(runDir, { recursive: true, force: true })
    }
  })
})
