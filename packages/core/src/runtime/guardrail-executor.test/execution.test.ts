import type { Guardrail, GuardrailVerdict } from '../../types/guardrail.js'
import type { StepConfig } from '../../types/harness.js'
import type { RunStateSnapshot } from '../../types/state.js'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { GuardrailMaxRetriesExceededError } from '../../errors/guardrail-max-retries-exceeded-error.js'
import { readLedgerEvents } from '../../persistence/ledger-writer.js'
import { readRunState, writeRunStateAtomic } from '../../persistence/state-store.js'
import { runAfterStepGuardrails } from '../guardrail-executor.js'

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'guardrail-execution-test-'))
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

describe('runAfterStepGuardrails empty afterStep', () => {
  it('clears activeGuardrailRetries and returns early if afterStep is empty', async () => {
    const runDir = makeTempDir()
    try {
      const snapshot = makeInitialSnapshot(runDir)
      snapshot.activeGuardrailRetries = { 0: 1 }
      const step: StepConfig = {
        id: 's-1',
        run: async () => ({}),
      }
      const ctx = {
        runId: 'r-1',
        environments: {},
        steps: {},
        step: { id: 's-1', output: {}, attempt: 1 },
        matrix: undefined,
        artifacts: {} as any,
      }

      await runAfterStepGuardrails({
        step,
        ctx,
        snapshot,
        runDir,
        attempt: 1,
        maxTotalTurns: 5,
        initialPrompt: '',
      })

      expect(snapshot.activeGuardrailRetries).toBeUndefined()
      expect(readRunState(runDir).activeGuardrailRetries).toBeUndefined()
    }
    finally {
      fs.rmSync(runDir, { recursive: true, force: true })
    }
  })
})

describe('runAfterStepGuardrails factory validation', () => {
  it('rejects a factory that returns an invalid guardrail', async () => {
    const runDir = makeTempDir()
    try {
      const snapshot = makeInitialSnapshot(runDir)
      const step: StepConfig = {
        id: 's-1',
        afterStep: (() => ['invalid']) as any,
        run: async () => ({}),
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
        maxTotalTurns: 5,
        initialPrompt: '',
      })).rejects.toThrow('afterStep factory returned an invalid Guardrail at index 0.')
    }
    finally {
      fs.rmSync(runDir, { recursive: true, force: true })
    }
  })
})

describe('runAfterStepGuardrails factory shape validation', () => {
  it('rejects a factory that does not return an array', async () => {
    const runDir = makeTempDir()
    try {
      const snapshot = makeInitialSnapshot(runDir)
      const step: StepConfig = {
        id: 's-1',
        afterStep: (() => 123) as any,
        run: async () => ({}),
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
        maxTotalTurns: 5,
        initialPrompt: '',
      })).rejects.toThrow('afterStep factory must return an array.')
    }
    finally {
      fs.rmSync(runDir, { recursive: true, force: true })
    }
  })
})

describe('runAfterStepGuardrails passing and skipped runs', () => {
  it('runs passing and skipped guardrails, recording ledger events', async () => {
    const runDir = makeTempDir()
    try {
      const snapshot = makeInitialSnapshot(runDir)
      const step: StepConfig = {
        id: 's-1',
        afterStep: [
          makeGuardrail({ status: 'pass' }),
          makeGuardrail({ status: 'skip' }),
        ],
        run: async () => ({}),
      }
      const ctx = {
        runId: 'r-1',
        environments: {},
        steps: {},
        step: { id: 's-1', output: {}, attempt: 1 },
        matrix: undefined,
        artifacts: {} as any,
      }

      await runAfterStepGuardrails({
        step,
        ctx,
        snapshot,
        runDir,
        attempt: 1,
        maxTotalTurns: 5,
        initialPrompt: '',
      })

      const events = readLedgerEvents(runDir)
      expect(events.map(e => e.eventType)).toEqual([
        'guardrail.started',
        'guardrail.passed',
        'guardrail.started',
        'guardrail.skipped',
      ])
    }
    finally {
      fs.rmSync(runDir, { recursive: true, force: true })
    }
  })
})

describe('runAfterStepGuardrails deterministic TS callback failures', () => {
  it('throws GuardrailMaxRetriesExceededError immediately for deterministic TS callbacks', async () => {
    const runDir = makeTempDir()
    try {
      const snapshot = makeInitialSnapshot(runDir)
      const step: StepConfig = {
        id: 's-1',
        afterStep: [
          makeGuardrail({ status: 'fail', body: 'lint failed' }, { maxRetries: 3 }),
        ],
        run: async () => ({}),
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
        maxTotalTurns: 5,
        initialPrompt: '',
      })).rejects.toThrow(GuardrailMaxRetriesExceededError)

      expect(readRunState(runDir).activeGuardrailRetries?.['0']).toBe(1)
    }
    finally {
      fs.rmSync(runDir, { recursive: true, force: true })
    }
  })
})
