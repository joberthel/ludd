import { describe, expect, it } from 'vitest'
import { RunNotFoundError } from './run-not-found-error.js'

describe('run not found error', () => {
  it('includes the missing run id in its message and properties', () => {
    const error = new RunNotFoundError('run-123')
    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('RunNotFoundError')
    expect(error.runId).toBe('run-123')
    expect(error.message).toBe('Run "run-123" was not found.')
  })
})
