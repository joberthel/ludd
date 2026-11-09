import { describe, expect, it } from 'vitest'
import { EnvironmentUnreachableError } from './environment-unreachable-error.js'

describe('environmentUnreachableError', () => {
  it('formats default error message with envId and workingDir', () => {
    const error = new EnvironmentUnreachableError('env-1', '/tmp/nonexistent-env')
    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('EnvironmentUnreachableError')
    expect(error.envId).toBe('env-1')
    expect(error.workingDir).toBe('/tmp/nonexistent-env')
    expect(error.message).toBe(
      'Environment "env-1" (workingDir: "/tmp/nonexistent-env") is unreachable. Health check ping failed during rehydration.',
    )
  })

  it('uses custom message when provided', () => {
    const error = new EnvironmentUnreachableError('env-custom', '/custom/path', 'Custom error message')
    expect(error.message).toBe('Custom error message')
    expect(error.envId).toBe('env-custom')
    expect(error.workingDir).toBe('/custom/path')
  })
})
