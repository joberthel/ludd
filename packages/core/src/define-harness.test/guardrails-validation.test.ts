import type { Guardrail } from '../types/guardrail.js'
import { describe, expect, it } from 'vitest'
import { validateHarnessConfig } from '../define-harness.js'

function makeValidGuardrail(): Guardrail {
  return {
    __kind: 'guardrail',
    type: 'fn',
    execute: async () => ({ status: 'pass' }),
  }
}

describe('validateHarnessConfig beforeStep validation', () => {
  it('rejects step with non-array beforeStep', () => {
    expect(() => validateHarnessConfig({
      name: 'test',
      steps: [
        {
          id: 's1',
          beforeStep: 'invalid' as any,
          run: () => {},
        },
      ],
    })).toThrow('Step "s1" "beforeStep" property must be an array when provided.')
  })

  it('rejects step with invalid item in beforeStep', () => {
    expect(() => validateHarnessConfig({
      name: 'test',
      steps: [
        {
          id: 's1',
          beforeStep: [
            { not: 'a-guardrail' } as any,
          ],
          run: () => {},
        },
      ],
    })).toThrow('Step "s1" beforeStep at index 0 must be a valid Guardrail instance.')
  })
})
describe('validateHarnessConfig afterStep validation', () => {
  it('rejects step with non-array afterStep', () => {
    expect(() => validateHarnessConfig({
      name: 'test',
      steps: [
        {
          id: 's1',
          afterStep: 123 as any,
          run: () => {},
        },
      ],
    })).toThrow('Step "s1" "afterStep" property must be an array when provided.')
  })

  it('rejects step with invalid item in afterStep', () => {
    expect(() => validateHarnessConfig({
      name: 'test',
      steps: [
        {
          id: 's1',
          afterStep: [
            makeValidGuardrail(),
            'not-a-rail' as any,
          ],
          run: () => {},
        },
      ],
    })).toThrow('Step "s1" afterStep at index 1 must be a valid Guardrail instance.')
  })

  it('accepts step with valid beforeStep and afterStep guardrails', () => {
    const config = validateHarnessConfig({
      name: 'test',
      steps: [
        {
          id: 's1',
          beforeStep: [
            makeValidGuardrail(),
          ],
          afterStep: [
            makeValidGuardrail(),
          ],
          run: () => {},
        },
      ],
    })
    expect(config.steps[0].beforeStep).toHaveLength(1)
    expect(config.steps[0].afterStep).toHaveLength(1)
  })
})

it('accepts a context-aware afterStep factory', () => {
  const config = validateHarnessConfig({
    name: 'test',
    steps: [
      {
        id: 's1',
        afterStep: () => [
          makeValidGuardrail(),
        ],
        run: () => ({ ok: true }),
      },
    ],
  })
  expect(config.steps[0].afterStep).toBeTypeOf('function')
})
