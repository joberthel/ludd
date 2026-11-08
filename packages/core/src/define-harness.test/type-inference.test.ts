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
