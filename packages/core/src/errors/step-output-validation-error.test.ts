import type { z } from 'zod'
import { describe, expect, it } from 'vitest'
import { StepOutputValidationError } from './step-output-validation-error.js'

describe('stepOutputValidationError instance and properties', () => {
  it('instantiates correctly and preserves properties', () => {
    const issues: z.core.$ZodIssue[] = [
      {
        code: 'too_small',
        minimum: 5,
        origin: 'string',
        inclusive: true,
        exact: false,
        message: 'String must contain at least 5 character(s)',
        path: ['commitMessage'],
      },
    ]
    const rawOutput = { commitMessage: 'fix' }
    const error = new StepOutputValidationError('implement-slices', rawOutput, issues)

    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(StepOutputValidationError)
    expect(error.name).toBe('StepOutputValidationError')
    expect(error.stepId).toBe('implement-slices')
    expect(error.rawOutput).toBe(rawOutput)
    expect(error.issues).toEqual(issues)
    expect(error.message).toBe(
      'Step "implement-slices" output validation failed: commitMessage: String must contain at least 5 character(s)',
    )
  })

  it('formats root path when issue path is empty', () => {
    const issues: z.core.$ZodIssue[] = [
      {
        code: 'invalid_type',
        expected: 'object',
        input: 'string',
        message: 'Expected object, received string',
        path: [],
      },
    ]
    const error = new StepOutputValidationError('root-step', 'invalid-string', issues)
    expect(error.message).toBe(
      'Step "root-step" output validation failed: <root>: Expected object, received string',
    )
  })
})

describe('stepOutputValidationError issue formatting variants', () => {
  it('formats multiple issues joined with semicolon', () => {
    const issues: z.core.$ZodIssue[] = [
      {
        code: 'invalid_type',
        expected: 'string',
        input: 'number',
        message: 'Expected string, received number',
        path: ['nested', 'field'],
      },
      {
        code: 'invalid_value',
        values: ['ready', 'needs_clarification'],
        input: 'invalid',
        message: 'Invalid enum value',
        path: ['status'],
      },
    ]
    const error = new StepOutputValidationError('multi-issue-step', {}, issues)
    expect(error.message).toBe(
      'Step "multi-issue-step" output validation failed: nested.field: Expected string, received number; status: Invalid enum value',
    )
  })

  it('formats message when issues array is empty', () => {
    const error = new StepOutputValidationError('empty-issues-step', null, [])
    expect(error.message).toBe('Step "empty-issues-step" output validation failed.')
  })
})
