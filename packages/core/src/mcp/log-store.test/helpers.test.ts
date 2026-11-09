import { describe, expect, it } from 'vitest'
import {
  extractByDotPath,
  extractJsonItems,
  sanitizeLogKey,
  splitTextLines,
} from '../log-store-helpers.js'

describe('log-store-helpers sanitization and path resolution', () => {
  it('sanitizes valid log keys and strips prefixes and extensions', () => {
    expect(sanitizeLogKey('step1-1')).toBe('step1-1')
    expect(sanitizeLogKey('step1-1.log')).toBe('step1-1')
    expect(sanitizeLogKey('logs/step1-1.log')).toBe('step1-1')
    expect(sanitizeLogKey('/logs/step1-1.log')).toBe('step1-1')
    expect(sanitizeLogKey('step1-1.items.json')).toBe('step1-1')
    expect(sanitizeLogKey('\\logs\\step1-1.log')).toBe('step1-1')
  })

  it('throws on invalid log keys', () => {
    expect(() => sanitizeLogKey('' as any)).toThrow('Log key must be a non-empty string.')
    expect(() => sanitizeLogKey('   ')).toThrow('Log key must be a non-empty string.')
    expect(() => sanitizeLogKey(123 as any)).toThrow('Log key must be a non-empty string.')
    expect(() => sanitizeLogKey('a\0b')).toThrow('Log key cannot contain null bytes.')
    expect(() => sanitizeLogKey('.')).toThrow('Log key contains invalid path segment')
    expect(() => sanitizeLogKey('..')).toThrow('Log key contains invalid path segment')
    expect(() => sanitizeLogKey('/')).toThrow('Log key contains invalid path segment')
  })
})

describe('log-store-helpers dot-path extraction and parsing', () => {
  it('extractByDotPath navigates dot notation and handles non-objects', () => {
    expect(extractByDotPath({
      a: { b: 42 },
    }, 'a.b')).toBe(42)
    expect(extractByDotPath(null, 'a.b')).toBeUndefined()
    expect(extractByDotPath('str', 'a.b')).toBeUndefined()
    expect(extractByDotPath({ a: 1 }, 'a.b')).toBeUndefined()
    expect(extractByDotPath({ a: null }, 'a.b')).toBeUndefined()
  })

  it('extractJsonItems extracts using selector function, dot-path string, or key object', () => {
    const fnSelector = (d: any) => d.files
    expect(extractJsonItems({
      files: ['f1', 'f2'],
    }, fnSelector)).toEqual([
      'f1',
      'f2',
    ])
    expect(extractJsonItems({ files: 'not-array' }, fnSelector)).toEqual([])

    expect(extractJsonItems({
      errors: ['e1'],
    }, 'errors')).toEqual(['e1'])
    expect(extractJsonItems(['a', 'b'], 'errors')).toEqual([
      'a',
      'b',
    ])
    expect(extractJsonItems('primitive', 'errors')).toEqual([])

    expect(extractJsonItems({
      reports: ['r1'],
    }, { key: 'reports' })).toEqual(['r1'])
    expect(extractJsonItems(['top'], { key: 'missing' })).toEqual(['top'])
    expect(extractJsonItems(123, { key: 'missing' })).toEqual([])

    expect(extractJsonItems(['direct1', 'direct2'])).toEqual([
      'direct1',
      'direct2',
    ])
    expect(extractJsonItems({
      errors: ['auto-err'],
    })).toEqual(['auto-err'])
    expect(extractJsonItems({
      items: ['auto-item'],
    })).toEqual(['auto-item'])
    expect(extractJsonItems({ other: 123 })).toEqual([
      { other: 123 },
    ])
    expect(extractJsonItems('not-an-object')).toEqual([])
  })
})

describe('log-store-helpers line splitting', () => {
  it('splitTextLines splits correctly across LF, CRLF, and trailing newlines', () => {
    expect(splitTextLines('')).toEqual([])
    expect(splitTextLines('line1\nline2')).toEqual([
      'line1',
      'line2',
    ])
    expect(splitTextLines('line1\r\nline2\r\n')).toEqual([
      'line1',
      'line2',
    ])
    expect(splitTextLines('line1\n')).toEqual(['line1'])
  })
})
