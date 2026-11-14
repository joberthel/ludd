import { describe, expect, expectTypeOf, it } from 'vitest'
import { z } from 'zod'
import { createHarness } from '../define-harness.js'
import { HarnessConfigError } from '../errors/harness-config-error.js'

describe('createHarness fluent builder', () => {
  it('infers ctx.steps and ctx.beforeStep across a 3-step Plain -> Plain -> Plain pipeline', () => {
    const harness = createHarness('three-plain-steps')
      .step({
        id: 'step-1',
        outputSchema: z.object({
          count: z.number(),
        }),
        run: () => ({ count: 10 }),
      })
      .step({
        id: 'step-2',
        beforeStep: () => ({
          token: {
            __kind: 'guardrail' as const,
            type: 'human_review' as const,
            execute: async () => ({ status: 'pass' as const, body: 'abc' }),
          },
        }),
        outputSchema: z.object({
          label: z.string(),
        }),
        run: (ctx) => {
          expectTypeOf(ctx.steps['step-1'].output).toEqualTypeOf<{ count: number } | undefined>()
          expectTypeOf(ctx.beforeStep.token).toEqualTypeOf<string>()
          return { label: `${ctx.beforeStep.token}:${ctx.steps['step-1'].output?.count ?? 0}` }
        },
      })
      .step({
        id: 'step-3',
        run: (ctx) => {
          expectTypeOf(ctx.steps['step-1'].output).toEqualTypeOf<{ count: number } | undefined>()
          expectTypeOf(ctx.steps['step-2'].output).toEqualTypeOf<{ label: string } | undefined>()
          return { done: true }
        },
      })
      .build()

    expect(harness.name).toBe('three-plain-steps')
    expect(harness.steps).toHaveLength(3)
  })

  it('infers context across a 5-step pipeline exceeding the previous 4-step limit', () => {
    const harness = createHarness('five-step-pipeline', {
      cleanupPolicy: { onSuccess: 'destroy' },
    })
      .step({
        id: 'init',
        outputSchema: z.object({
          seed: z.number(),
        }),
        run: () => ({ seed: 1 }),
      })
      .step({
        id: 'prepare',
        outputSchema: z.object({
          ready: z.boolean(),
        }),
        run: (ctx) => {
          expectTypeOf(ctx.steps.init.output).toEqualTypeOf<{ seed: number } | undefined>()
          return { ready: true }
        },
      })
      .step({
        id: 'fanout',
        matrix: {
          items: [1, 2, 3] as const,
        },
        outputSchema: z.object({
          doubled: z.number(),
        }),
        run: (ctx) => {
          expectTypeOf(ctx.matrix.item).toEqualTypeOf<1 | 2 | 3>()
          expectTypeOf(ctx.steps.prepare.output).toEqualTypeOf<{ ready: boolean } | undefined>()
          return { doubled: ctx.matrix.item * 2 }
        },
      })
      .step({
        id: 'summarize',
        outputSchema: z.object({
          total: z.number(),
        }),
        run: (ctx) => {
          expectTypeOf(ctx.steps.fanout.output).toEqualTypeOf<{ doubled: number }[] | undefined>()
          return { total: 12 }
        },
        afterStep: (ctx) => {
          expectTypeOf(ctx.step.output).toEqualTypeOf<{ total: number }>()
          return []
        },
      })
      .step({
        id: 'finalize',
        run: (ctx) => {
          expectTypeOf(ctx.steps.summarize.output).toEqualTypeOf<{ total: number } | undefined>()
          return { ok: true }
        },
      })
      .build()

    expect(harness.name).toBe('five-step-pipeline')
    expect(harness.cleanupPolicy).toEqual({ onSuccess: 'destroy' })
    expect(harness.steps).toHaveLength(5)
  })

  it('validates config on build()', () => {
    expect(() => createHarness('empty-steps').build()).toThrow(HarnessConfigError)
  })
})
