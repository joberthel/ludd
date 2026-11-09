import type { GuardrailExecutionInput, StepContext } from '@ludd/core'
import { isGuardrail } from '@ludd/core'
import { describe, expect, it } from 'vitest'
import { humanReviewGuardrail } from './human-review-guardrail.js'

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
})

describe('humanReviewGuardrail creation and execution', () => {
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

  it('constructs a valid Guardrail instance with type human_review', () => {
    const rail = humanReviewGuardrail({
      prompt: 'Please review specifications',
    })

    expect(rail.__kind).toBe('guardrail')
    expect(rail.type).toBe('human_review')
    expect(rail.prompt).toBe('Please review specifications')
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

  it('executes with dynamic prompt function and passes context', async () => {
    const rail = humanReviewGuardrail({
      prompt: ctx => `Step ${ctx.step.id} (attempt ${ctx.step.attempt}): Review required`,
    })

    const verdict = await rail.execute(dummyInput)
    expect(verdict.status).toBe('pass')
    expect(verdict.body).toBe('Step s-1 (attempt 1): Review required')
  })
})
