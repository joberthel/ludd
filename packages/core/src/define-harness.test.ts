import type { AgentRunner, StepConfig } from './types/harness.js'
import { describe, expect, expectTypeOf, it } from 'vitest'
import { z } from 'zod'
import { defineHarness, validateHarnessConfig } from './define-harness.js'
import { HarnessConfigError } from './errors/harness-config-error.js'
import { isAgentRunner } from './types/harness.js'

describe('isAgentRunner type guard', () => {
  it('returns true for valid AgentRunner', () => {
    const runner: AgentRunner = {
      __kind: 'agent',
      execute: async () => 'done',
    }
    expect(isAgentRunner(runner)).toBe(true)
  })

  it('returns false for primitives and null', () => {
    expect(isAgentRunner(null)).toBe(false)
    expect(isAgentRunner(undefined)).toBe(false)
    expect(isAgentRunner('agent')).toBe(false)
    expect(isAgentRunner(123)).toBe(false)
  })

  it('returns false for objects missing required properties', () => {
    expect(isAgentRunner({})).toBe(false)
    expect(isAgentRunner({ __kind: 'other' })).toBe(false)
    expect(isAgentRunner({ __kind: 'agent' })).toBe(false)
    expect(isAgentRunner({ __kind: 'agent', execute: 'not-fn' })).toBe(false)
  })
})

describe('harnessConfigError', () => {
  it('instantiates correctly with name and message', () => {
    const error = new HarnessConfigError('invalid harness')
    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('HarnessConfigError')
    expect(error.message).toBe('invalid harness')
  })
})

describe('validateHarnessConfig root structure and name', () => {
  it('rejects non-object configurations', () => {
    expect(() => validateHarnessConfig(null)).toThrow(HarnessConfigError)
    expect(() => validateHarnessConfig('invalid')).toThrow('must be a non-null object')
    expect(() => validateHarnessConfig([])).toThrow('must be a non-null object')
  })

  it('rejects invalid or empty harness names', () => {
    expect(() => validateHarnessConfig({ name: 123, steps: [] })).toThrow('must be a non-empty trimmed string')
    expect(() => validateHarnessConfig({ name: '', steps: [] })).toThrow('must be a non-empty trimmed string')
    expect(() => validateHarnessConfig({ name: '   ', steps: [] })).toThrow('must be a non-empty trimmed string')
  })
})

describe('validateHarnessConfig cleanupPolicy and steps array', () => {
  it('rejects invalid cleanupPolicy configuration', () => {
    expect(() => validateHarnessConfig({
      name: 'test',
      cleanupPolicy: 'invalid',
      steps: [
        {
          id: 's1',
          run: () => {},
        },
      ],
    })).toThrow('must be an object')

    expect(() => validateHarnessConfig({
      name: 'test',
      cleanupPolicy: { onSuccess: 'invalid' },
      steps: [
        {
          id: 's1',
          run: () => {},
        },
      ],
    })).toThrow('cleanupPolicy.onSuccess')

    expect(() => validateHarnessConfig({
      name: 'test',
      cleanupPolicy: { onFailure: 'invalid' },
      steps: [
        {
          id: 's1',
          run: () => {},
        },
      ],
    })).toThrow('cleanupPolicy.onFailure')
  })

  it('rejects missing or empty steps array', () => {
    expect(() => validateHarnessConfig({ name: 'test', steps: 'invalid' })).toThrow('must be a non-empty array')
    expect(() => validateHarnessConfig({ name: 'test', steps: [] })).toThrow('must be a non-empty array')
  })
})

describe('validateHarnessConfig step structure', () => {
  it('rejects non-object step items', () => {
    expect(() => validateHarnessConfig({
      name: 'test',
      steps: [null],
    })).toThrow('must be a non-null object')
    expect(() => validateHarnessConfig({
      name: 'test',
      steps: ['not-step'],
    })).toThrow('must be a non-null object')
    expect(() => validateHarnessConfig({
      name: 'test',
      steps: [[]],
    })).toThrow('must be a non-null object')
  })
})

describe('validateHarnessConfig step id validation', () => {
  it('rejects invalid or whitespace-only step IDs', () => {
    expect(() => validateHarnessConfig({
      name: 'test',
      steps: [
        {
          id: 42,
          run: () => {},
        },
      ],
    })).toThrow('non-empty trimmed string "id"')
    expect(() => validateHarnessConfig({
      name: 'test',
      steps: [
        {
          id: '',
          run: () => {},
        },
      ],
    })).toThrow('non-empty trimmed string "id"')
    expect(() => validateHarnessConfig({
      name: 'test',
      steps: [
        {
          id: '   ',
          run: () => {},
        },
      ],
    })).toThrow('non-empty trimmed string "id"')
  })

  it('rejects duplicate step IDs naming the duplicate ID', () => {
    expect(() => validateHarnessConfig({
      name: 'test',
      steps: [
        {
          id: 'triage',
          run: () => {},
        },
        {
          id: 'triage',
          run: () => {},
        },
      ],
    })).toThrow('Duplicate step id "triage"')
  })
})

describe('validateHarnessConfig step run handler', () => {
  it('rejects step with invalid run property', () => {
    expect(() => validateHarnessConfig({
      name: 'test',
      steps: [
        { id: 's1', run: 123 },
      ],
    })).toThrow('Step "s1" must have a valid "run" property')
  })

  it('rejects step with invalid if predicate', () => {
    expect(() => validateHarnessConfig({
      name: 'test',
      steps: [
        {
          id: 's1',
          if: 123 as any,
          run: () => {},
        },
      ],
    })).toThrow('Step "s1" "if" property must be a function when provided.')
  })
})

describe('defineHarness composition and execution models', () => {
  it('validates and returns strong configuration with AgentRunner and cleanupPolicy', () => {
    const agent: AgentRunner<string> = {
      __kind: 'agent',
      execute: async () => 'agent-result',
    }
    const harness = defineHarness({
      name: 'pipeline',
      cleanupPolicy: { onSuccess: 'keep', onFailure: 'destroy' },
      steps: [
        { id: 'step-agent', run: agent },
      ],
    })
    expect(harness.name).toBe('pipeline')
    expect(harness.cleanupPolicy?.onSuccess).toBe('keep')
    expect(harness.cleanupPolicy?.onFailure).toBe('destroy')
    expect(harness.steps).toHaveLength(1)
  })

  it('composes reusable step arrays via spread syntax', () => {
    function createCommonSteps(): StepConfig[] {
      return [
        {
          id: 'setup',
          run: () => 'ok',
        },
      ]
    }
    const harness = defineHarness({
      name: 'composed-harness',
      steps: [
        ...createCommonSteps(),
        {
          id: 'custom',
          run: () => 'custom',
        },
      ],
    })
    expect(harness.steps).toHaveLength(2)
    expect(harness.steps[0].id).toBe('setup')
    expect(harness.steps[1].id).toBe('custom')
  })
})

describe('defineHarness outputSchema type inference', () => {
  it('infers strongly typed schema output for default and transform', () => {
    const harness = defineHarness({
      name: 'inferred-pipeline',
      steps: [
        {
          id: 'step-default',
          outputSchema: z.object({
            status: z.string().default('ready'),
          }),
          run: () => ({ status: 'ready' }),
        },
        {
          id: 'step-transform',
          outputSchema: z.string().transform(v => v.length),
          run: () => 42,
        },
      ],
    })
    expect(harness.name).toBe('inferred-pipeline')
    type DefaultOutput = z.infer<(typeof harness.steps)[0]['outputSchema']>
    type TransformOutput = z.infer<(typeof harness.steps)[1]['outputSchema']>
    expectTypeOf<DefaultOutput>().toEqualTypeOf<{ status: string }>()
    expectTypeOf<TransformOutput>().toEqualTypeOf<number>()
  })
})
