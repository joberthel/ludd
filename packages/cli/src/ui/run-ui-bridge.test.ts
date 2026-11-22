import { describe, expect, it, vi } from 'vitest'
import { formatToolArgsSummary, getRunUiHost, registerRunUiHost } from './run-ui-bridge.js'

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
})
