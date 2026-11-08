import type { AgentRunner, AgentTurnInput } from '../types/agent.js'
import type { StepContext } from '../types/context.js'
import type { StepConfig } from '../types/harness.js'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { StepOutputValidationError } from '../errors/step-output-validation-error.js'
import { executeAgentStep, validateStepOutput } from './agent-executor.js'

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
  it('resolves dynamic prompt and generates default sessionId', async () => {
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

    expect(output).toBe('done')
    expect(captured?.stepId).toBe('s-1')
    expect(captured?.prompt).toBe('Prompt for r-exec-test')
    expect(captured?.sessionId).toMatch(/^session-[0-9a-f-]+$/)
    expect(captured?.mode).toBe('read-only')
    expect(captured?.attempt).toBe(1)
    expect(captured?.runDir).toBe('/tmp/run-dir')
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

    const output = await executeAgentStep(step, agent, ctx, '/tmp/run-dir')
    expect(output).toEqual({ count: 84 })
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
