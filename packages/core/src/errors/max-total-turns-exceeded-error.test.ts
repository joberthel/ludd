import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MAX_TOTAL_TURNS,
  MaxTotalTurnsExceededError,
} from './max-total-turns-exceeded-error.js'

describe('maxTotalTurnsExceededError', () => {
  it('exposes DEFAULT_MAX_TOTAL_TURNS as 15', () => {
    expect(DEFAULT_MAX_TOTAL_TURNS).toBe(15)
  })

  it('constructs with stepId and maxTotalTurns without lastError', () => {
    const error = new MaxTotalTurnsExceededError('agent-step-1', 10)
    expect(error.name).toBe('MaxTotalTurnsExceededError')
    expect(error.stepId).toBe('agent-step-1')
    expect(error.maxTotalTurns).toBe(10)
    expect(error.lastError).toBeUndefined()
    expect(error.message).toBe('Step "agent-step-1" exceeded maximum total turns (10).')
    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(MaxTotalTurnsExceededError)
  })

  it('constructs with lastError and appends message details', () => {
    const cause = new Error('Schema violation in commitMessage')
    const error = new MaxTotalTurnsExceededError('agent-step-2', 5, cause)
    expect(error.stepId).toBe('agent-step-2')
    expect(error.maxTotalTurns).toBe(5)
    expect(error.lastError).toBe(cause)
    expect(error.message).toContain('exceeded maximum total turns (5): Schema violation in commitMessage')
  })

  it('handles non-Error lastError', () => {
    const error = new MaxTotalTurnsExceededError('agent-step-3', 3, 'raw string cause')
    expect(error.lastError).toBe('raw string cause')
    expect(error.message).toBe('Step "agent-step-3" exceeded maximum total turns (3).')
  })
})
