import { describe, expect, it } from 'vitest'
import { RunAlreadyActiveError } from './run-already-active-error.js'

describe('runAlreadyActiveError', () => {
  it('instantiates with default message and exposes runId and pid properties', () => {
    const error = new RunAlreadyActiveError('run-123', 45678)

    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('RunAlreadyActiveError')
    expect(error.runId).toBe('run-123')
    expect(error.pid).toBe(45678)
    expect(error.message).toBe('Run "run-123" is already active with process PID 45678.')
  })

  it('uses custom message when provided', () => {
    const customMessage = 'Custom run already active message'
    const error = new RunAlreadyActiveError('run-abc', 9999, customMessage)

    expect(error.message).toBe(customMessage)
    expect(error.runId).toBe('run-abc')
    expect(error.pid).toBe(9999)
  })
})
