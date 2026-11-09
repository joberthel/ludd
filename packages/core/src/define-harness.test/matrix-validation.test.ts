import { describe, expect, it } from 'vitest'
import { defineHarness, validateHarnessConfig } from '../define-harness.js'
import { HarnessConfigError } from '../errors/harness-config-error.js'

describe('validateHarnessConfig valid matrix configurations', () => {
  it('accepts valid matrix with static items array', () => {
    const config = {
      name: 'valid-matrix-static',
      steps: [
        {
          id: 'step-static',
          matrix: {
            items: ['slice-1', 'slice-2'],
          },
          run: () => 'ok',
        },
      ],
    }
    expect(() => validateHarnessConfig(config)).not.toThrow()
    expect(defineHarness(config)).toEqual(config)
  })

  it('accepts valid matrix with dynamic items function', () => {
    const config = {
      name: 'valid-matrix-dynamic',
      steps: [
        {
          id: 'step-dynamic',
          matrix: {
            items: () => [1, 2, 3],
          },
          run: () => 'ok',
        },
      ],
    }
    expect(() => validateHarnessConfig(config)).not.toThrow()
  })

  it('accepts valid matrix with itemsFromArtifact', () => {
    const config = {
      name: 'valid-matrix-artifact',
      steps: [
        {
          id: 'step-artifact',
          matrix: { itemsFromArtifact: 'todos.json' },
          run: () => 'ok',
        },
      ],
    }
    expect(() => validateHarnessConfig(config)).not.toThrow()
  })
})

describe('validateHarnessConfig matrix type validation', () => {
  it('throws HarnessConfigError if matrix is not a non-null plain object', () => {
    for (const invalid of ['not-an-object', 123, null, [], true]) {
      const config = {
        name: 'invalid-matrix-type',
        steps: [
          {
            id: 'step-1',
            matrix: invalid,
            run: () => 'ok',
          },
        ],
      }
      expect(() => validateHarnessConfig(config)).toThrow(HarnessConfigError)
      expect(() => validateHarnessConfig(config)).toThrow(
        'Step "step-1" "matrix" property must be a non-null object when provided.',
      )
    }
  })
})

describe('validateHarnessConfig matrix mutual exclusivity validation', () => {
  it('throws HarnessConfigError if matrix specifies neither or both items and itemsFromArtifact', () => {
    const configNeither = {
      name: 'neither',
      steps: [
        {
          id: 'step-neither',
          matrix: {},
          run: () => 'ok',
        },
      ],
    }
    expect(() => validateHarnessConfig(configNeither)).toThrow(
      'Step "step-neither" matrix must specify either "items" or "itemsFromArtifact", not both or neither.',
    )

    const configBoth = {
      name: 'both',
      steps: [
        {
          id: 'step-both',
          matrix: {
            items: ['a'],
            itemsFromArtifact: 'todos.json',
          },
          run: () => 'ok',
        },
      ],
    }
    expect(() => validateHarnessConfig(configBoth)).toThrow(
      'Step "step-both" matrix must specify either "items" or "itemsFromArtifact", not both or neither.',
    )
  })
})

describe('validateHarnessConfig matrix property validation', () => {
  it('throws HarnessConfigError if items is not a non-empty array or a function', () => {
    for (const invalid of [[], 'not-array', 123, {}, null, false]) {
      const config = {
        name: 'invalid-items',
        steps: [
          {
            id: 'step-items',
            matrix: { items: invalid },
            run: () => 'ok',
          },
        ],
      }
      expect(() => validateHarnessConfig(config)).toThrow(
        'Step "step-items" matrix "items" must be a non-empty array or a function.',
      )
    }
  })

  it('throws HarnessConfigError if itemsFromArtifact is not a non-empty trimmed string', () => {
    for (const invalid of ['', '   ', 123, [], {}, null]) {
      const config = {
        name: 'invalid-artifact-key',
        steps: [
          {
            id: 'step-artifact',
            matrix: { itemsFromArtifact: invalid },
            run: () => 'ok',
          },
        ],
      }
      expect(() => validateHarnessConfig(config)).toThrow(
        'Step "step-artifact" matrix "itemsFromArtifact" must be a non-empty trimmed string.',
      )
    }
  })
})
