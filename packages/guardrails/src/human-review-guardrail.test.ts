import type { GuardrailExecutionInput, StepContext } from '@ludd/core'
import { isGuardrail } from '@ludd/core'
import { describe, expect, it } from 'vitest'
import { humanReviewGuardrail } from './human-review-guardrail.js'

const dummyCtx: StepContext = {
  runId: 'r-test',
  environments: {},
  steps: {},
  step: { id: 's-1', output: undefined, attempt: 1 },
  matrix: undefined,
  artifacts: {} as any,
}

const dummyInput: GuardrailExecutionInput = {
  ctx: dummyCtx,
  stepId: 's-1',
  phase: 'beforeStep',
  guardrailIndex: 0,
  attempt: 1,
  runDir: '/tmp/run',
  environment: {} as any,
  mcpServerUrl: 'http://localhost:3000',
  mcpAuthToken: 'token',
}

describe('humanReviewGuardrail configuration validation', () => {
  it('throws TypeError when config is not an object', () => {
    expect(() => humanReviewGuardrail(null as any)).toThrow(TypeError)
    expect(() => humanReviewGuardrail(undefined as any)).toThrow(TypeError)
    expect(() => humanReviewGuardrail('invalid' as any)).toThrow(TypeError)
    expect(() => humanReviewGuardrail([] as any)).toThrow(TypeError)
  })

  it('throws TypeError when prompt is not a string or function', () => {
    expect(() => humanReviewGuardrail({ prompt: 123 as any })).toThrow(TypeError)
    expect(() => humanReviewGuardrail({ prompt: null as any })).toThrow(TypeError)
    expect(() => humanReviewGuardrail({ prompt: {} as any })).toThrow(TypeError)
  })

  it('validates maxRetries configuration', () => {
    expect(() => humanReviewGuardrail({ prompt: 'Review', maxRetries: -1 })).toThrow(
      new TypeError('humanReviewGuardrail "maxRetries" must be a non-negative integer.'),
    )
    expect(() => humanReviewGuardrail({ prompt: 'Review', maxRetries: 1.5 })).toThrow(
      new TypeError('humanReviewGuardrail "maxRetries" must be a non-negative integer.'),
    )
    expect(() => humanReviewGuardrail({ prompt: 'Review', maxRetries: '2' as any })).toThrow(
      new TypeError('humanReviewGuardrail "maxRetries" must be a non-negative integer.'),
    )

    const valid = humanReviewGuardrail({ prompt: 'Review', maxRetries: 3 })
    expect(valid.maxRetries).toBe(3)
  })
})

describe('humanReviewGuardrail creation and execution', () => {
  it('constructs a valid Guardrail instance with type human_review', () => {
    const rail = humanReviewGuardrail({
      prompt: 'Please review specifications',
      maxRetries: 2,
    })

    expect(rail.__kind).toBe('guardrail')
    expect(rail.type).toBe('human_review')
    expect(rail.prompt).toBe('Please review specifications')
    expect(rail.maxRetries).toBe(2)
    expect(isGuardrail(rail)).toBe(true)
  })

  it('executes with static string prompt and returns pass verdict with body', async () => {
    const rail = humanReviewGuardrail({
      prompt: 'Review architecture RFC',
    })

    const verdict = await rail.execute(dummyInput)
    expect(verdict.status).toBe('pass')
    expect(verdict.body).toBe('Review architecture RFC')
  })

  it('executes with dynamic prompt function and passes context with step output', async () => {
    const rail = humanReviewGuardrail({
      prompt: ctx => `Step ${ctx.step.id} (attempt ${ctx.step.attempt}): ${JSON.stringify(ctx.step.output)}`,
    })

    const ctxWithOutput: StepContext = {
      ...dummyCtx,
      step: {
        id: 's-1',
        attempt: 2,
        output: { spec: 'Auth API RFC', completed: true },
      },
    }

    const verdict = await rail.execute({
      ...dummyInput,
      ctx: ctxWithOutput,
      attempt: 2,
    })
    expect(verdict.status).toBe('pass')
    expect(verdict.body).toBe('Step s-1 (attempt 2): {"spec":"Auth API RFC","completed":true}')
  })
})
