import { humanReviewGuardrail } from '@ludd/guardrails'
import { describe, expect, expectTypeOf, it } from 'vitest'
import { defineHarness } from '../define-harness.js'

describe('defineHarness beforeStep result inference with humanReviewGuardrail', () => {
  it('infers ctx.beforeStep.guess as string from keyed humanReviewGuardrail without generic annotation', () => {
    const harness = defineHarness({
      name: 'human-review-keyed',
      steps: [
        {
          id: 'guess-step',
          beforeStep: () => ({
            guess: humanReviewGuardrail({ prompt: 'Input a number.' }),
          }),
          run: (ctx) => {
            expectTypeOf(ctx.beforeStep.guess).toEqualTypeOf<string>()
            return { guess: ctx.beforeStep.guess }
          },
        },
      ],
    })

    expect(harness.steps[0].id).toBe('guess-step')
  })

  it('infers ctx.beforeStep[0] as string from array humanReviewGuardrail without generic annotation', () => {
    const harness = defineHarness({
      name: 'human-review-array',
      steps: [
        {
          id: 'guess-step',
          beforeStep: () => [
            humanReviewGuardrail({ prompt: 'Input a number.' }),
          ],
          run: (ctx) => {
            expectTypeOf(ctx.beforeStep[0]).toEqualTypeOf<string>()
            return { guess: ctx.beforeStep[0] }
          },
        },
      ],
    })

    expect(harness.steps[0].id).toBe('guess-step')
  })

  it('infers ctx.beforeStep.guess in a static beforeStep map and in afterStep', () => {
    const harness = defineHarness({
      name: 'human-review-static-and-after',
      steps: [
        {
          id: 'guess-step',
          beforeStep: {
            guess: humanReviewGuardrail({ prompt: 'Input a number.' }),
          },
          run: (ctx) => {
            expectTypeOf(ctx.beforeStep.guess).toEqualTypeOf<string>()
            return { guess: ctx.beforeStep.guess }
          },
          afterStep: (ctx) => {
            expectTypeOf(ctx.beforeStep.guess).toEqualTypeOf<string>()
            return []
          },
        },
      ],
    })

    expect(harness.steps[0].id).toBe('guess-step')
  })

  it('infers prior step output and ctx.beforeStep in a 2-step plain harness', () => {
    const harness = defineHarness({
      name: 'two-plain-with-before-step',
      steps: [
        {
          id: 'first',
          run: () => ({ count: 3 }),
        },
        {
          id: 'second',
          beforeStep: () => ({
            guess: humanReviewGuardrail({ prompt: 'Input a number.' }),
          }),
          run: (ctx) => {
            expectTypeOf(ctx.steps.first.output).toEqualTypeOf<{ count: number } | undefined>()
            expectTypeOf(ctx.beforeStep.guess).toEqualTypeOf<string>()
            return { doubled: (ctx.steps.first.output?.count ?? 0) * 2, guess: ctx.beforeStep.guess }
          },
        },
      ],
    })

    expect(harness.steps[1].id).toBe('second')
  })
})
