import type { AgentRunner, AgentTurnInput } from '../types/agent.js'
import type { StepContext } from '../types/context.js'
import type { StepConfig } from '../types/harness.js'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { StepOutputValidationError } from '../errors/step-output-validation-error.js'
import {
  createAgentStepOutput,
  executeAgentStep,
  validateStepOutput,
} from './agent-executor.js'

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

describe('executeAgentStep dynamic prompt and default session resolution', () => {
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

    const output = await executeAgentStep(step, agent, ctx, '/tmp/run-dir')

    expect(captured?.stepId).toBe('s-1')
    expect(captured?.prompt).toBe('Prompt for r-exec-test')
    expect(captured?.sessionId).toMatch(/^session-[0-9a-f-]+$/)
    expect(captured?.mode).toBe('read-only')
    expect(captured?.attempt).toBe(1)
    expect(captured?.runDir).toBe('/tmp/run-dir')
    expect(output).toEqual({ value: 'done', sessionId: captured?.sessionId })
  })
})

describe('executeAgentStep dynamic sessionId and fallback handling', () => {
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

    await executeAgentStep(step, customAgent, ctx, '/tmp/run-dir')
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
    await executeAgentStep({ id: 's-3', run: fallbackAgent }, fallbackAgent, ctx, '/tmp/run-dir')
    expect(capturedSessId).toMatch(/^session-[0-9a-f-]+$/)
  })
})

describe('createAgentStepOutput output merging helper', () => {
  it('merges sessionId directly on plain objects and wraps primitives / arrays', () => {
    expect(createAgentStepOutput({ key: 'val' }, 's-1')).toEqual({
      key: 'val',
      sessionId: 's-1',
    })
    expect(createAgentStepOutput('str', 's-2')).toEqual({
      value: 'str',
      sessionId: 's-2',
    })
    expect(createAgentStepOutput([1, 2], 's-3')).toEqual({
      value: [1, 2],
      sessionId: 's-3',
    })
    expect(createAgentStepOutput(null, 's-4')).toEqual({
      value: null,
      sessionId: 's-4',
    })
    expect(createAgentStepOutput(undefined, 's-5')).toEqual({
      value: undefined,
      sessionId: 's-5',
    })
  })
})

describe('executeAgentStep and validateStepOutput schema handling', () => {
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

    const output = (await executeAgentStep(step, agent, ctx, '/tmp/run-dir')) as {
      count: number
      sessionId: string
    }
    expect(output.count).toBe(84)
    expect(output.sessionId).toMatch(/^session-[0-9a-f-]+$/)
  })

  it('throws StepOutputValidationError when output violates outputSchema', async () => {
    const schema = z.object({
      requiredField: z.string(),
    })
    await expect(validateStepOutput('step-err', schema, {
      requiredField: 123,
    })).rejects.toThrow(StepOutputValidationError)
  })
})
