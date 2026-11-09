import { describe, expect, it } from 'vitest'
import { validateHarnessConfig } from '../define-harness.js'

describe('validateHarnessConfig step artifacts root type validation', () => {
  it('rejects non-object artifacts property', () => {
    expect(() => validateHarnessConfig({
      name: 'test',
      steps: [
        {
          id: 's1',
          artifacts: 'invalid' as any,
          run: () => {},
        },
      ],
    })).toThrow('Step "s1" "artifacts" property must be a non-null object when provided.')

    expect(() => validateHarnessConfig({
      name: 'test',
      steps: [
        {
          id: 's1',
          artifacts: null as any,
          run: () => {},
        },
      ],
    })).toThrow('Step "s1" "artifacts" property must be a non-null object when provided.')

    expect(() => validateHarnessConfig({
      name: 'test',
      steps: [
        {
          id: 's1',
          artifacts: [] as any,
          run: () => {},
        },
      ],
    })).toThrow('Step "s1" "artifacts" property must be a non-null object when provided.')
  })
})

describe('validateHarnessConfig step artifacts key validation', () => {
  it('rejects empty or whitespace-only artifact keys', () => {
    expect(() => validateHarnessConfig({
      name: 'test',
      steps: [
        {
          id: 's1',
          artifacts: {
            '': {},
          },
          run: () => {},
        },
      ],
    })).toThrow('Step "s1" artifact key must be a non-empty trimmed string.')

    expect(() => validateHarnessConfig({
      name: 'test',
      steps: [
        {
          id: 's1',
          artifacts: {
            '   ': {},
          },
          run: () => {},
        },
      ],
    })).toThrow('Step "s1" artifact key must be a non-empty trimmed string.')
  })
})

describe('validateHarnessConfig step artifact rule object validation', () => {
  it('rejects non-object rule definition', () => {
    expect(() => validateHarnessConfig({
      name: 'test',
      steps: [
        {
          id: 's1',
          artifacts: {
            'spec.md': null as any,
          },
          run: () => {},
        },
      ],
    })).toThrow('Step "s1" artifact "spec.md" validation rule must be a non-null object.')

    expect(() => validateHarnessConfig({
      name: 'test',
      steps: [
        {
          id: 's1',
          artifacts: {
            'spec.md': [] as any,
          },
          run: () => {},
        },
      ],
    })).toThrow('Step "s1" artifact "spec.md" validation rule must be a non-null object.')
  })
})

describe('validateHarnessConfig step artifact rule schema and nonEmpty properties', () => {
  it('rejects invalid nonEmpty and schema properties', () => {
    expect(() => validateHarnessConfig({
      name: 'test',
      steps: [
        {
          id: 's1',
          artifacts: {
            'spec.md': { nonEmpty: 'yes' as any },
          },
          run: () => {},
        },
      ],
    })).toThrow('Step "s1" artifact "spec.md" "nonEmpty" must be a boolean when provided.')

    expect(() => validateHarnessConfig({
      name: 'test',
      steps: [
        {
          id: 's1',
          artifacts: {
            'todos.json': { schema: 123 as any },
          },
          run: () => {},
        },
      ],
    })).toThrow('Step "s1" artifact "todos.json" "schema" must be a valid Zod schema when provided.')

    expect(() => validateHarnessConfig({
      name: 'test',
      steps: [
        {
          id: 's1',
          artifacts: {
            'todos.json': { schema: {} as any },
          },
          run: () => {},
        },
      ],
    })).toThrow('Step "s1" artifact "todos.json" "schema" must be a valid Zod schema when provided.')
  })
})

describe('validateHarnessConfig step artifact rule validate property', () => {
  it('rejects invalid validate function property type', () => {
    expect(() => validateHarnessConfig({
      name: 'test',
      steps: [
        {
          id: 's1',
          artifacts: {
            'spec.md': { validate: 'not-a-func' as any },
          },
          run: () => {},
        },
      ],
    })).toThrow('Step "s1" artifact "spec.md" "validate" must be a function when provided.')
  })
})

describe('validateHarnessConfig valid step artifact configurations', () => {
  it('accepts valid artifact rules', () => {
    const valid = validateHarnessConfig({
      name: 'valid-artifacts-pipeline',
      steps: [
        {
          id: 'step-1',
          artifacts: {
            'spec.md': {
              nonEmpty: true,
              validate: (c: string) => c.length > 0,
            },
            'todos.json': {
              schema: {
                safeParseAsync: async () => ({ success: true, data: [] }),
              } as any,
            },
          },
          run: () => {},
        },
      ],
    })
    expect(valid.steps[0].artifacts).toBeDefined()
  })
})
