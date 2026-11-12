import type { AgentRunner } from '../../types/agent.js'
import type { ArtifactClient, StepContext } from '../../types/context.js'
import type { StepConfig } from '../../types/harness.js'
import type { RunStateSnapshot } from '../../types/state.js'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { appendLedgerEvent, readLedgerEvents } from '../../persistence/ledger-writer.js'
import { executeAgentStep } from '../agent-executor.js'

let tempDir: string

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-agent-matrix-exec-'))
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

function createMatrixContext(index: number, total = 2): StepContext {
  return {
    runId: 'r-matrix-exec',
    environments: {},
    steps: {},
    step: { id: 'step-matrix', output: undefined, attempt: 1 },
    matrix: { index, total, item: `item-${index}` },
    artifacts: {} as ArtifactClient,
  }
}

function createSnapshot(): RunStateSnapshot {
  return {
    schemaVersion: 1,
    runId: 'r-matrix-exec',
    harnessName: 'test-harness',
    workflowName: 'test-harness',
    status: 'running',
    activeStepId: 'step-matrix',
    activeSessionId: null,
    activeStepAttempt: 1,
    steps: {},
    updatedAt: new Date().toISOString(),
  }
}

function seedRetryEvent(runDir: string, matrixIndex: number, message: string): void {
  appendLedgerEvent(runDir, {
    schemaVersion: 1,
    timestamp: new Date().toISOString(),
    runId: 'r-matrix-exec',
    stepId: 'step-matrix',
    matrixIndex,
    eventType: 'step.retry',
    payload: {
      attempt: 2,
      sessionId: `s-${matrixIndex}`,
      reason: 'output_schema_validation_failed',
      issues: [
        {
          path: ['name'],
          message,
        },
      ],
    },
  })
}

describe('executeAgentStep matrixIndex in ledger events', () => {
  it('includes matrixIndex on agent.stream.linked and step.retry ledger events', async () => {
    let callCount = 0
    const agent: AgentRunner<unknown> = {
      __kind: 'agent',
      mode: 'workspace-write',
      prompt: 'do slice',
      executeTurn: async (input) => {
        callCount++
        if (callCount === 1) {
          return { output: 'wrong-type', sessionId: input.sessionId }
        }
        return {
          output: { valid: true },
          sessionId: input.sessionId,
        }
      },
    }

    const step: StepConfig = {
      id: 'step-matrix',
      outputSchema: z.object({
        valid: z.boolean(),
      }),
      run: agent,
    }

    const ctx = createMatrixContext(1, 3)
    await executeAgentStep(step, agent, ctx, createSnapshot(), tempDir)

    const events = readLedgerEvents(tempDir)
    const streamLinked = events.filter(e => e.eventType === 'agent.stream.linked')
    const retries = events.filter(e => e.eventType === 'step.retry')

    expect(streamLinked.length).toBeGreaterThan(0)
    for (const event of streamLinked) {
      expect(event.matrixIndex).toBe(1)
    }
    expect(retries).toHaveLength(1)
    expect(retries[0].matrixIndex).toBe(1)
  })
})

describe('executeAgentStep matrixIndex during rehydration', () => {
  it('matches lastRetry for matching matrixIndex during rehydration', async () => {
    seedRetryEvent(tempDir, 0, 'slice 0 failed')
    seedRetryEvent(tempDir, 1, 'slice 1 failed')

    let capturedPrompt: string | undefined
    const agent: AgentRunner<string> = {
      __kind: 'agent',
      mode: 'read-only',
      prompt: 'base prompt',
      executeTurn: async (input) => {
        capturedPrompt = input.prompt
        return { output: 'done', sessionId: input.sessionId }
      },
    }
    const step: StepConfig = { id: 'step-matrix', run: agent }

    const ctx = createMatrixContext(0, 2)
    await executeAgentStep(step, agent, ctx, createSnapshot(), tempDir, {
      sessionId: 's-0',
      attempt: 2,
    })

    expect(capturedPrompt).toContain('slice 0 failed')
    expect(capturedPrompt).not.toContain('slice 1 failed')
  })
})
