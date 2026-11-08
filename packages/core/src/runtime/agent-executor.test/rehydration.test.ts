import type { AgentRunner } from '../../types/agent.js'
import type { StepContext } from '../../types/context.js'
import type { StepConfig } from '../../types/harness.js'
import type { RunStateSnapshot } from '../../types/state.js'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { appendLedgerEvent } from '../../persistence/ledger-writer.js'
import { executeAgentStep } from '../agent-executor.js'

function createDummyContext(): StepContext {
  return {
    runId: 'r-exec-test',
    environments: {},
    steps: {},
    step: { id: 'test-step', output: undefined, attempt: 1 },
    matrix: undefined,
    artifacts: {},
  }
}

function createDummySnapshot(stepId = 'test-step'): RunStateSnapshot {
  return {
    schemaVersion: 1,
    runId: 'r-exec-test',
    harnessName: 'test-harness',
    status: 'running',
    activeStepId: stepId,
    activeSessionId: null,
    activeStepAttempt: 1,
    steps: {},
    updatedAt: new Date().toISOString(),
  }
}

describe('executeAgentStep rehydration without matching ledger events', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-agent-rehydrate-other-'))
  })
  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('uses initialPrompt when resuming without prior ledger retry events for step', async () => {
    appendLedgerEvent(tempDir, {
      schemaVersion: 1,
      timestamp: new Date().toISOString(),
      runId: 'r-exec-test',
      stepId: 'other-step',
      eventType: 'step.retry',
      payload: { attempt: 2, sessionId: 's-other', issues: [] },
    })

    let capturedPrompt: string | undefined
    const agent: AgentRunner<string> = {
      __kind: 'agent',
      mode: 'read-only',
      prompt: 'initial prompt text',
      executeTurn: async (input) => {
        capturedPrompt = input.prompt
        return { output: 'resumed-output', sessionId: input.sessionId }
      },
    }
    const step: StepConfig = { id: 's-rehydrate', run: agent }

    await executeAgentStep(step, agent, createDummyContext(), createDummySnapshot('s-rehydrate'), tempDir, {
      sessionId: 'sess-rehydrated',
      attempt: 2,
    })

    expect(capturedPrompt).toBe('initial prompt text')
  })
})

describe('executeAgentStep rehydration without ledger file', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-agent-rehydrate-no-ledger-'))
  })
  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('uses initialPrompt when ledger.jsonl does not exist on rehydration', async () => {
    let capturedPrompt: string | undefined
    const agent: AgentRunner<string> = {
      __kind: 'agent',
      mode: 'read-only',
      prompt: 'initial prompt text',
      executeTurn: async (input) => {
        capturedPrompt = input.prompt
        return { output: 'resumed-output', sessionId: input.sessionId }
      },
    }
    const step: StepConfig = { id: 's-no-ledger', run: agent }

    await executeAgentStep(step, agent, createDummyContext(), createDummySnapshot('s-no-ledger'), tempDir, {
      sessionId: 'sess-no-ledger',
      attempt: 2,
    })

    expect(capturedPrompt).toBe('initial prompt text')
  })
})
