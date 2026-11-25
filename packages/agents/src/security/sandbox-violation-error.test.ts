import { describe, expect, it } from 'vitest'
import { SandboxViolationError } from './sandbox-violation-error.js'

describe('sandboxViolationError', () => {
  it('formats the default message', () => {
    const error = new SandboxViolationError('/w/.git/hooks')
    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('SandboxViolationError')
    expect(error.targetPath).toBe('/w/.git/hooks')
    expect(error.message).toBe('Sandbox violation for "/w/.git/hooks": Path access is not permitted by the sandbox.')
  })

  it('uses a custom reason', () => {
    const error = new SandboxViolationError('/x', 'nope')
    expect(error.reason).toBe('nope')
    expect(error.message).toBe('Sandbox violation for "/x": nope.')
  })
})
