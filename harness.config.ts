import { piAgent } from '@ludd/agents'
import { defineHarness } from '@ludd/core'
import { fnGuardrail, humanReviewGuardrail } from '@ludd/guardrails'
import { z } from 'zod'

export default defineHarness({
  name: 'e2e-custom',
  steps: [
    {
      id: 'step',
      beforeStep: () => [
        humanReviewGuardrail({
          prompt: `Input a number between 1 and 10.`,
        }),
      ],
      run: () => piAgent({
        prompt: `Choose a random number between 1 and 10.`,
      }),
      outputSchema: z.object({
        guess: z.number().min(1).max(10),
      }),
      afterStep: () => [
        fnGuardrail({
          run: () => {
            return { status: 'pass' }
          },
        }),
      ],
    },
  ],
})
