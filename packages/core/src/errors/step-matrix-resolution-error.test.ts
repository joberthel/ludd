import { describe, expect, it } from 'vitest'
import { StepMatrixResolutionError } from './step-matrix-resolution-error.js'

describe('stepMatrixResolutionError', () => {
  it('instantiates with stepId and reason, formats message and sets name', () => {
    const error = new StepMatrixResolutionError('step-matrix', 'Artifact "todos.json" not found.')
    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(StepMatrixResolutionError)
    expect(error.name).toBe('StepMatrixResolutionError')
    expect(error.stepId).toBe('step-matrix')
    expect(error.reason).toBe('Artifact "todos.json" not found.')
    expect(error.message).toBe('Step "step-matrix" matrix resolution failed: Artifact "todos.json" not found.')
  })
})
