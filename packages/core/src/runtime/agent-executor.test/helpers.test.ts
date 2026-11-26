import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { StepOutputValidationError } from '../../errors/step-output-validation-error.js'
import {
  createAgentStepOutput,
  formatRetryPrompt,
  resolveConfiguredSessionId,
  validateStepOutput,
} from '../agent-executor.js'

describe('createAgentStepOutput output merging helper', () => {
  it('merges sessionId directly on plain objects and wraps primitives / arrays', () => {
    expect(createAgentStepOutput({ key: 'val' }, 's-1')).toEqual({
      key: 'val',
      sessionId: 's-1',
    })
    expect(createAgentStepOutput('str', 's-2')).toEqual({
      value: 'str',
      sessionId: 's-2',
    })
    expect(createAgentStepOutput([1, 2], 's-3')).toEqual({
      value: [1, 2],
      sessionId: 's-3',
    })
    expect(createAgentStepOutput(null, 's-4')).toEqual({
      value: null,
      sessionId: 's-4',
    })
    expect(createAgentStepOutput(undefined, 's-5')).toEqual({
      value: undefined,
      sessionId: 's-5',
    })
  })
})

describe('validateStepOutput schema validation helper', () => {
  it('throws StepOutputValidationError when output violates outputSchema', async () => {
    const schema = z.object({
      requiredField: z.string(),
    })
    await expect(validateStepOutput('step-err', schema, {
      requiredField: 123,
    })).rejects.toThrow(StepOutputValidationError)
  })
})

describe('formatRetryPrompt helper', () => {
  it('formats field paths and issues into a structured prompt', () => {
    const formatted = formatRetryPrompt('original instruction', [
      {
        path: ['user', 'name'],
        message: 'Required',
      },
      { path: [], message: 'Root invalid' },
    ])
    expect(formatted).toContain('- [user.name]: Required')
    expect(formatted).toContain('- [(root)]: Root invalid')
    expect(formatted).toContain('original instruction')
  })
})

describe('resolveConfiguredSessionId helper', () => {
  it('trims static/dynamic sessionId values and returns undefined when absent or blank', async () => {
    const dummyCtx = {
      runId: 'r-1',
      steps: {},
      step: { id: 's-1', output: undefined, attempt: 1 },
      matrix: undefined,
      artifacts: {} as never,
    }
    expect(await resolveConfiguredSessionId(undefined, dummyCtx)).toBeUndefined()
    expect(await resolveConfiguredSessionId('  ', dummyCtx)).toBeUndefined()
    expect(await resolveConfiguredSessionId(() => undefined, dummyCtx)).toBeUndefined()
    expect(await resolveConfiguredSessionId('  sess-42  ', dummyCtx)).toBe('sess-42')
  })
})
