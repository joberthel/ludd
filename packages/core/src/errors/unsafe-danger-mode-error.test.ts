import { describe, expect, it } from 'vitest'
import { UnsafeDangerModeError } from './unsafe-danger-mode-error.js'

describe('unsafeDangerModeError', () => {
  it('formats default error message with stepId and environmentType', () => {
    const error = new UnsafeDangerModeError('deploy-step', 'host')
    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('UnsafeDangerModeError')
    expect(error.stepId).toBe('deploy-step')
    expect(error.environmentType).toBe('host')
    expect(error.message).toBe(
      'Step "deploy-step" requested dangerMode, but environment "host" does not support it (dangerMode is restricted to containerized/VM environments).',
    )
  })

  it('uses custom message when provided', () => {
    const error = new UnsafeDangerModeError('custom-step', 'git-worktree', 'Custom danger mode message')
    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('UnsafeDangerModeError')
    expect(error.stepId).toBe('custom-step')
    expect(error.environmentType).toBe('git-worktree')
    expect(error.message).toBe('Custom danger mode message')
  })
})
