import type { AgentRunner, AgentStepOutput } from '../types/agent.js'
import type { InferStepOutput } from '../types/harness.js'
import { describe, expect, expectTypeOf, it } from 'vitest'
import { z } from 'zod'
import { defineHarness } from '../define-harness.js'

describe('defineHarness outputSchema type inference', () => {
  it('infers strongly typed schema output for default and transform', () => {
    const harness = defineHarness({
      name: 'inferred-pipeline',
      steps: [
        {
          id: 'step-default',
          outputSchema: z.object({
            status: z.string().default('ready'),
          }),
          run: () => ({ status: 'ready' }),
        },
        {
          id: 'step-transform',
          outputSchema: z.string().transform(v => v.length),
          run: () => 42,
        },
      ],
    })
    expect(harness.name).toBe('inferred-pipeline')
    type DefaultOutput = z.infer<(typeof harness.steps)[0]['outputSchema']>
    type TransformOutput = z.infer<(typeof harness.steps)[1]['outputSchema']>
    expectTypeOf<DefaultOutput>().toEqualTypeOf<{ status: string }>()
    expectTypeOf<TransformOutput>().toEqualTypeOf<number>()
  })
})

describe('agentStepOutput type inference', () => {
  it('merges sessionId on objects and wraps primitives / arrays in value', () => {
    type ObjOutput = AgentStepOutput<{ score: number }>
    type PrimOutput = AgentStepOutput<string>
    type ArrOutput = AgentStepOutput<string[]>

    expectTypeOf<ObjOutput>().toEqualTypeOf<{ score: number } & { sessionId: string }>()
    expectTypeOf<PrimOutput>().toEqualTypeOf<{ value: string, sessionId: string }>()
    expectTypeOf<ArrOutput>().toEqualTypeOf<{ value: string[], sessionId: string }>()
  })
})

describe('inferStepOutput agent step with outputSchema (AC 3.2.3)', () => {
  it('infers agent step with outputSchema including sessionId', () => {
    const scoreSchema = z.object({
      score: z.number(),
      tags: z.array(z.string()),
    })
    const _agentStepWithSchema = {
      id: 'step-agent-schema',
      outputSchema: scoreSchema,
      run: {
        __kind: 'agent' as const,
        mode: 'read-only' as const,
        prompt: 'test prompt',
        executeTurn: async () => ({
          output: {
            score: 100,
            tags: ['fast'],
          },
          sessionId: 'sess-1',
        }),
      },
    }

    type AgentWithSchemaOut = InferStepOutput<typeof _agentStepWithSchema>
    expectTypeOf<AgentWithSchemaOut>().toEqualTypeOf<{
      score: number
      tags: string[]
    } & { sessionId: string }>()
  })
})

describe('inferStepOutput raw agent step and callback step types', () => {
  it('infers raw agent step and callback step types', () => {
    const _agentStepWithoutSchema = {
      id: 'step-agent-raw',
      run: {
        __kind: 'agent' as const,
        mode: 'read-only' as const,
        prompt: 'test',
        executeTurn: async () => ({ output: 'raw-value', sessionId: 'sess-2' }),
      } satisfies AgentRunner<string>,
    }

    const _callbackStep = {
      id: 'step-callback',
      outputSchema: z.object({
        count: z.number(),
      }),
      run: () => ({ count: 10 }),
    }

    type AgentRawOut = InferStepOutput<typeof _agentStepWithoutSchema>
    type CallbackOut = InferStepOutput<typeof _callbackStep>

    expectTypeOf<AgentRawOut>().toEqualTypeOf<{ value: string, sessionId: string }>()
    expectTypeOf<CallbackOut>().toEqualTypeOf<{ count: number }>()
  })
})
