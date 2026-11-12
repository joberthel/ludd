import type { AgentRunner, AgentTurnInput } from '../../types/agent.js'
import type { ArtifactClient, StepContext } from '../../types/context.js'
import type { StepConfig } from '../../types/harness.js'
import type { RunStateSnapshot } from '../../types/state.js'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { readLedgerEvents } from '../../persistence/ledger-writer.js'
import { readStreamEvents } from '../../persistence/stream-writer.js'
import { executeAgentStep } from '../agent-executor.js'

function createDummyContext(): StepContext {
  return {
    runId: 'r-exec-test',
    environments: {},
    steps: {},
    step: { id: 'test-step', output: undefined, attempt: 1 },
    matrix: undefined,
    artifacts: {} as ArtifactClient,
  }
}

function createDummySnapshot(stepId = 'test-step'): RunStateSnapshot {
  return {
    schemaVersion: 1,
    runId: 'r-exec-test',
    harnessName: 'test-harness',
    workflowName: 'test-harness',
    status: 'running',
    activeStepId: stepId,
    activeSessionId: null,
    activeStepAttempt: 1,
    steps: {},
    updatedAt: new Date().toISOString(),
  }
}

describe('executeAgentStep dynamic prompt and default session resolution', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-agent-exec-test-'))
  })
  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('resolves dynamic prompt, generates default sessionId, and merges output', async () => {
    let captured: AgentTurnInput | undefined
    const agent: AgentRunner<string> = {
      __kind: 'agent',
      mode: 'read-only',
      prompt: ctx => `Prompt for ${ctx.runId}`,
      executeTurn: async (input) => {
        captured = input
        return { output: 'done', sessionId: input.sessionId }
      },
    }
    const step: StepConfig = { id: 's-1', run: agent }
    const ctx = createDummyContext()

    const output = await executeAgentStep(step, agent, ctx, createDummySnapshot('s-1'), tempDir)

    expect(captured?.stepId).toBe('s-1')
    expect(captured?.prompt).toBe('Prompt for r-exec-test')
    expect(captured?.sessionId).toMatch(/^session-[0-9a-f-]+$/)
    expect(captured?.mode).toBe('read-only')
    expect(captured?.attempt).toBe(1)
    expect(captured?.runDir).toBe(tempDir)
    expect(output).toEqual({ value: 'done', sessionId: captured?.sessionId })

    const ledgerEvents = readLedgerEvents(tempDir)
    expect(ledgerEvents).toHaveLength(1)
    expect(ledgerEvents[0].eventType).toBe('agent.stream.linked')
    expect(ledgerEvents[0].payload).toEqual({
      sessionId: captured?.sessionId,
      streamPath: `streams/${captured?.sessionId}.jsonl`,
      attempt: 1,
    })

    const streamEvents = readStreamEvents(tempDir, captured!.sessionId)
    expect(streamEvents).toHaveLength(2)
    expect(streamEvents[0].eventType).toBe('turn.started')
    expect(streamEvents[0].payload).toEqual({
      prompt: 'Prompt for r-exec-test',
      mode: 'read-only',
    })
    expect(streamEvents[1].eventType).toBe('turn.completed')
    expect(streamEvents[1].payload).toEqual({
      output: 'done',
    })
  })
})

describe('executeAgentStep outputSchema forwarding', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-agent-exec-schema-'))
  })
  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('forwards the step outputSchema to the agent turn only when declared', async () => {
    const seen: AgentTurnInput[] = []
    const agent: AgentRunner<unknown> = {
      __kind: 'agent',
      mode: 'read-only',
      prompt: 'p',
      executeTurn: async (input) => {
        seen.push(input)
        return {
          output: { ok: true },
          sessionId: input.sessionId,
        }
      },
    }
    const schema = z.object({
      ok: z.boolean(),
    })
    await executeAgentStep({ id: 's-1', run: agent, outputSchema: schema }, agent, createDummyContext(), createDummySnapshot('s-1'), tempDir)
    await executeAgentStep({ id: 's-1', run: agent }, agent, createDummyContext(), createDummySnapshot('s-1'), tempDir)
    expect(seen[0]?.outputSchema).toBe(schema)
    expect(seen[1]).not.toHaveProperty('outputSchema')
  })
})

describe('executeAgentStep dynamic sessionId and fallback handling', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-agent-exec-sess-'))
  })
  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('resolves dynamic sessionId and handles undefined resolution fallback', async () => {
    let capturedSessId: string | undefined
    const customAgent: AgentRunner<string> = {
      __kind: 'agent',
      mode: 'workspace-write',
      prompt: 'static prompt',
      sessionId: ctx => `sess-${ctx.runId}`,
      executeTurn: async (input) => {
        capturedSessId = input.sessionId
        return { output: 'ok', sessionId: input.sessionId }
      },
    }
    const step: StepConfig = { id: 's-2', run: customAgent }
    const ctx = createDummyContext()

    await executeAgentStep(step, customAgent, ctx, createDummySnapshot('s-2'), tempDir)
    expect(capturedSessId).toBe('sess-r-exec-test')

    const fallbackAgent: AgentRunner<string> = {
      __kind: 'agent',
      mode: 'workspace-write',
      prompt: 'static prompt',
      sessionId: () => undefined,
      executeTurn: async (input) => {
        capturedSessId = input.sessionId
        return { output: 'fallback', sessionId: input.sessionId }
      },
    }
    await executeAgentStep({ id: 's-3', run: fallbackAgent }, fallbackAgent, ctx, createDummySnapshot('s-3'), tempDir)
    expect(capturedSessId).toMatch(/^session-[0-9a-f-]+$/)
  })
})

describe('executeAgentStep outputSchema handling and transformation', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-agent-exec-schema-'))
  })
  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('validates and transforms output according to step outputSchema', async () => {
    const agent: AgentRunner<{ count: number }> = {
      __kind: 'agent',
      mode: 'read-only',
      prompt: 'compute count',
      executeTurn: async input => ({
        output: { count: 42 },
        sessionId: input.sessionId,
      }),
    }
    const schema = z.object({
      count: z.number().transform(n => n * 2),
    })
    const step: StepConfig = { id: 's-schema', run: agent, outputSchema: schema }
    const ctx = createDummyContext()

    const output = (await executeAgentStep(step, agent, ctx, createDummySnapshot('s-schema'), tempDir)) as {
      count: number
      sessionId: string
    }
    expect(output.count).toBe(84)
    expect(output.sessionId).toMatch(/^session-[0-9a-f-]+$/)
  })
})
