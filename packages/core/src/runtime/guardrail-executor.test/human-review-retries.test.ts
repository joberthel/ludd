import type { AgentRunner } from '../../types/agent.js'
import type { StepConfig } from '../../types/harness.js'
import type { RunStateSnapshot } from '../../types/state.js'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { GuardrailMaxRetriesExceededError } from '../../errors/guardrail-max-retries-exceeded-error.js'
import { writeRunStateAtomic } from '../../persistence/state-store.js'
import { createGateWaiter } from '../gate-waiter.js'
import { GuardrailRetrySignal, runAfterStepGuardrails } from '../guardrail-executor.js'

const fakeAgent: AgentRunner = {
  __kind: 'agent',
  mode: 'workspace-write',
  prompt: 'test agent',
  executeTurn: async () => ({ output: 'test-output', sessionId: 'sess-hr' }),
}

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ludd-hr-retries-test-'))
}

function makeInitialSnapshot(runDir: string): RunStateSnapshot {
  const snapshot: RunStateSnapshot = {
    schemaVersion: 1,
    runId: 'r-hr-test',
    harnessName: 'test-harness',
    workflowName: 'test-harness',
    status: 'running',
    activeStepId: 's-hr',
    steps: {},
    updatedAt: new Date().toISOString(),
  }
  writeRunStateAtomic(runDir, snapshot)
  return snapshot
}

function makeReviewContext() {
  return {
    runId: 'r-hr-test',
    steps: {},
    step: { id: 's-hr', output: null as any, attempt: 1 },
    matrix: undefined,
    artifacts: {} as any,
  }
}

function makeReviewGuardrail(maxRetries?: number) {
  return {
    __kind: 'guardrail' as const,
    type: 'human_review' as const,
    prompt: 'Review output',
    maxRetries,
    execute: async () => ({ status: 'pass' as const }),
  }
}

const defaultRail = makeReviewGuardrail()
const boundedRail = makeReviewGuardrail(1)

describe('runAfterStepGuardrails unbounded retries initial failure', () => {
  it('signals retry on first failure without exceeding maxRetries', async () => {
    const runDir = makeTempDir()
    try {
      const snapshot = makeInitialSnapshot(runDir)
      const waiter = createGateWaiter()
      const rails = [defaultRail]
      const step: StepConfig = {
        id: 's-hr',
        afterStep: rails,
        run: fakeAgent,
      }
      const ctx = makeReviewContext()

      const p = runAfterStepGuardrails({
        step,
        ctx,
        snapshot,
        runDir,
        attempt: 1,
        sessionId: 'sess-hr',
        initialPrompt: 'Initial prompt',
        gateWaiter: waiter,
      })
      await new Promise(r => setTimeout(r, 10))
      waiter.resolve({ stepId: 's-hr', action: 'fail', feedback: 'Fix issue' })
      await expect(p).rejects.toThrow(GuardrailRetrySignal)
      expect(snapshot.activeGuardrailRetries?.['0']).toBe(1)
    }
    finally {
      fs.rmSync(runDir, { recursive: true, force: true })
    }
  })
})

describe('runAfterStepGuardrails humanReviewGuardrail explicit maxRetries', () => {
  it('signals retry on attempt 1 and throws when retries exceed explicit maxRetries', async () => {
    const runDir = makeTempDir()
    try {
      const snapshot = makeInitialSnapshot(runDir)
      const waiter = createGateWaiter()
      const rails = [boundedRail]
      const step: StepConfig = {
        id: 's-hr',
        afterStep: rails,
        run: fakeAgent,
      }
      const ctx = makeReviewContext()

      const p1 = runAfterStepGuardrails({
        step,
        ctx,
        snapshot,
        runDir,
        attempt: 1,
        sessionId: 'sess-hr',
        initialPrompt: 'Initial prompt',
        gateWaiter: waiter,
      })
      await new Promise(r => setTimeout(r, 10))
      waiter.resolve({ stepId: 's-hr', action: 'fail', feedback: 'Attempt 1 failed' })
      const signal1 = await p1.catch((err: unknown) => err) as GuardrailRetrySignal
      expect(signal1).toBeInstanceOf(GuardrailRetrySignal)
      expect(signal1.prompt).toContain('User hint:\nAttempt 1 failed')

      const p2 = runAfterStepGuardrails({
        step,
        ctx,
        snapshot,
        runDir,
        attempt: 2,
        sessionId: 'sess-hr',
        initialPrompt: 'Initial prompt',
        gateWaiter: waiter,
      })
      await new Promise(r => setTimeout(r, 10))
      waiter.resolve({ stepId: 's-hr', action: 'fail', feedback: 'Attempt 2 failed' })
      await expect(p2).rejects.toThrow(GuardrailMaxRetriesExceededError)
    }
    finally {
      fs.rmSync(runDir, { recursive: true, force: true })
    }
  })
})

describe('runAfterStepGuardrails non-agent failure', () => {
  it('throws GuardrailMaxRetriesExceededError immediately for non-agent steps', async () => {
    const runDir = makeTempDir()
    try {
      const snapshot = makeInitialSnapshot(runDir)
      const waiter = createGateWaiter()
      const rails = [defaultRail]
      const step: StepConfig = {
        id: 's-hr',
        afterStep: rails,
        run: async () => ({ ok: true }),
      }
      const ctx = makeReviewContext()

      const p = runAfterStepGuardrails({
        step,
        ctx,
        snapshot,
        runDir,
        attempt: 1,
        initialPrompt: '',
        gateWaiter: waiter,
      })
      await new Promise(r => setTimeout(r, 10))
      waiter.resolve({ stepId: 's-hr', action: 'fail', feedback: 'Non-agent fail' })
      await expect(p).rejects.toThrow(GuardrailMaxRetriesExceededError)
    }
    finally {
      fs.rmSync(runDir, { recursive: true, force: true })
    }
  })
})
