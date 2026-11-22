import { describe, expect, it, vi } from 'vitest'
import { formatToolArgsSummary, getRunUiHost, registerRunUiHost, toHarnessBlueprint } from './run-ui-bridge.js'

describe('run-ui-bridge', () => {
  it('registers, retrieves, and unregisters the active RunUiHost safely', () => {
    expect(getRunUiHost()).toBeUndefined()
    const first = {
      pushEntry: vi.fn(),
      setActivity: vi.fn(),
    }
    const second = {
      pushEntry: vi.fn(),
      setActivity: vi.fn(),
    }
    const unregFirst = registerRunUiHost(first)
    expect(getRunUiHost()).toBe(first)
    const unregSecond = registerRunUiHost(second)
    expect(getRunUiHost()).toBe(second)
    unregFirst()
    expect(getRunUiHost()).toBe(second)
    unregSecond()
    expect(getRunUiHost()).toBeUndefined()
  })

  it('formats tool arguments concisely and truncates long values', () => {
    expect(formatToolArgsSummary(undefined)).toBeUndefined()
    expect(formatToolArgsSummary(null)).toBeUndefined()
    expect(formatToolArgsSummary({})).toBeUndefined()
    expect(formatToolArgsSummary('plain')).toBe('"plain"')
    expect(formatToolArgsSummary([1, 2])).toBe('[1,2]')
    expect(formatToolArgsSummary({ guess: 7, key: 'log-1' })).toBe('guess=7 key=log-1')
    const longText = 'a'.repeat(80)
    const formatted = formatToolArgsSummary({ text: longText })!
    expect(formatted.endsWith('…')).toBe(true)
    expect(formatted.length).toBeLessThan(70)
  })

  it('extracts HarnessBlueprint from HarnessConfig with array/object guardrails and matrix steps', () => {
    const bp = toHarnessBlueprint({
      name: 'my-flow',
      steps: [
        {
          id: 's1',
          name: 'Step One',
          matrix: {
            items: [1, 2],
          },
          beforeStep: [
            {
              __kind: 'guardrail',
              type: 'fn',
              name: 'ctx',
              execute: async () => ({ status: 'pass' }),
            },
            {
              __kind: 'guardrail',
              type: 'fn',
              execute: async () => ({ status: 'pass' }),
            },
          ],
          afterStep: [
            {
              __kind: 'guardrail',
              type: 'fn',
              name: 'lint',
              execute: async () => ({ status: 'pass' }),
            },
            {
              __kind: 'guardrail',
              type: 'fn',
              execute: async () => ({ status: 'pass' }),
            },
          ],
          run: () => 'ok',
        },
        {
          id: 's2',
          beforeStep: {
            namedKey: {
              __kind: 'guardrail',
              type: 'fn',
              name: 'custom',
              execute: async () => ({ status: 'pass' }),
            },
            fallbackKey: {
              __kind: 'guardrail',
              type: 'fn',
              execute: async () => ({ status: 'pass' }),
            },
          },
          run: () => 'ok',
        },
        {
          id: 's3',
          beforeStep: () => [],
          run: () => 'ok',
        },
      ],
    })

    expect(bp).toEqual({
      harnessName: 'my-flow',
      steps: [
        {
          id: 's1',
          name: 'Step One',
          hasMatrix: true,
          beforeStep: [
            { index: 0, name: 'ctx' },
            { index: 1 },
          ],
          afterStep: [
            { index: 0, name: 'lint' },
            { index: 1 },
          ],
        },
        {
          id: 's2',
          hasMatrix: false,
          beforeStep: [
            { index: 0, name: 'custom' },
            { index: 1, name: 'fallbackKey' },
          ],
        },
        {
          id: 's3',
          hasMatrix: false,
        },
      ],
    })

    const withRunId = toHarnessBlueprint({ name: 'my-flow', steps: [] }, 'run-123')
    expect(withRunId.runId).toBe('run-123')
    const withoutRunId = toHarnessBlueprint({ name: 'my-flow', steps: [] })
    expect(withoutRunId.runId).toBeUndefined()
  })
})
