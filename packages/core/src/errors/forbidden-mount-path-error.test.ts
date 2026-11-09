import { describe, expect, it } from 'vitest'
import { ForbiddenMountPathError } from './forbidden-mount-path-error.js'

describe('forbiddenMountPathError', () => {
  it('formats default error message with hostPath and default reason', () => {
    const error = new ForbiddenMountPathError('/workspace/.harness/runs')
    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('ForbiddenMountPathError')
    expect(error.hostPath).toBe('/workspace/.harness/runs')
    expect(error.reason).toBe('Mount path is inside a forbidden directory')
    expect(error.message).toBe('Forbidden mount path "/workspace/.harness/runs": Mount path is inside a forbidden directory.')
  })

  it('uses custom reason when provided', () => {
    const error = new ForbiddenMountPathError('/workspace/.git/hooks', 'Mount path resolves inside .git/hooks')
    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('ForbiddenMountPathError')
    expect(error.hostPath).toBe('/workspace/.git/hooks')
    expect(error.reason).toBe('Mount path resolves inside .git/hooks')
    expect(error.message).toBe('Forbidden mount path "/workspace/.git/hooks": Mount path resolves inside .git/hooks.')
  })
})
