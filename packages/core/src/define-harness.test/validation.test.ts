import { describe, expect, it } from 'vitest'
import { validateHarnessConfig } from '../define-harness.js'
import { HarnessConfigError } from '../errors/harness-config-error.js'

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

describe('validateHarnessConfig invalid maxTotalTurns (AC 3.4.4)', () => {
  it('rejects step with non-positive or non-integer maxTotalTurns', () => {
    expect(() => validateHarnessConfig({
      name: 'test',
      steps: [
        {
          id: 's1',
          maxTotalTurns: 0,
          run: () => {},
        },
      ],
    })).toThrow('Step "s1" maxTotalTurns must be a positive integer, received 0.')

    expect(() => validateHarnessConfig({
      name: 'test',
      steps: [
        {
          id: 's1',
          maxTotalTurns: -3,
          run: () => {},
        },
      ],
    })).toThrow('Step "s1" maxTotalTurns must be a positive integer, received -3.')

    expect(() => validateHarnessConfig({
      name: 'test',
      steps: [
        {
          id: 's1',
          maxTotalTurns: 2.5,
          run: () => {},
        },
      ],
    })).toThrow('Step "s1" maxTotalTurns must be a positive integer, received 2.5.')

    expect(() => validateHarnessConfig({
      name: 'test',
      steps: [
        {
          id: 's1',
          maxTotalTurns: '10' as any,
          run: () => {},
        },
      ],
    })).toThrow('Step "s1" maxTotalTurns must be a positive integer, received 10.')
  })
})

describe('validateHarnessConfig valid maxTotalTurns', () => {
  it('accepts step with valid positive integer maxTotalTurns', () => {
    const valid = validateHarnessConfig({
      name: 'test',
      steps: [
        {
          id: 's1',
          maxTotalTurns: 5,
          run: () => {},
        },
      ],
    })
    expect(valid.steps[0].maxTotalTurns).toBe(5)
  })
})

describe('validateHarnessConfig step artifacts configuration', () => {
  it('validates step artifacts configuration', () => {
    expect(() => validateHarnessConfig({
      name: 'test',
      steps: [
        {
          id: 's1',
          artifacts: 'invalid' as any,
          run: () => {},
        },
      ],
    })).toThrow('must be a non-null object')

    const valid = validateHarnessConfig({
      name: 'test',
      steps: [
        {
          id: 's1',
          artifacts: {
            'spec.md': { nonEmpty: true },
          },
          run: () => {},
        },
      ],
    })
    expect(valid.steps[0].artifacts).toBeDefined()
  })
})
