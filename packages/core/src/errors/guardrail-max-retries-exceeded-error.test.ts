import { describe, expect, it } from 'vitest'
import { GuardrailMaxRetriesExceededError } from './guardrail-max-retries-exceeded-error.js'

describe('guardrailMaxRetriesExceededError', () => {
  it('constructs with stepId, guardrailIndex, maxRetries, and verdict without body', () => {
    const error = new GuardrailMaxRetriesExceededError('step-1', 0, 2, { status: 'fail' })
    expect(error.name).toBe('GuardrailMaxRetriesExceededError')
    expect(error.stepId).toBe('step-1')
    expect(error.guardrailIndex).toBe(0)
    expect(error.maxRetries).toBe(2)
    expect(error.verdict).toEqual({ status: 'fail' })
    expect(error.message).toBe('Step "step-1" guardrail #0 exceeded maximum retries (2).')
    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(GuardrailMaxRetriesExceededError)
  })

  it('constructs with string verdict body and includes in message', () => {
    const error = new GuardrailMaxRetriesExceededError('step-2', 1, 0, {
      status: 'fail',
      body: 'phpstan found 3 errors',
    })
    expect(error.message).toBe(
      'Step "step-2" guardrail #1 exceeded maximum retries (0): phpstan found 3 errors.',
    )
  })

  it('constructs with object verdict body and serializes in message', () => {
    const error = new GuardrailMaxRetriesExceededError('step-3', 2, 3, {
      status: 'fail',
      body: {
        issues: ['type error'],
      },
    })
    expect(error.message).toContain('{"issues":["type error"]}')
  })
})
