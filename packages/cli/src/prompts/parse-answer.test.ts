import { describe, expect, it } from 'vitest'
import { parseStringAnswer } from './parse-answer.js'

describe('parseStringAnswer', () => {
  it('parses text, number, confirm, select, and multi-select values and defaults', () => {
    expect(parseStringAnswer({ type: 'text', prompt: 'Q', default: 'def' }, '')).toBe('def')
    expect(parseStringAnswer({ type: 'text', prompt: 'Q' }, 'abc')).toBe('abc')

    expect(parseStringAnswer({ type: 'number', prompt: 'Q', default: 5 }, ' ')).toBe(5)
    expect(parseStringAnswer({
      type: 'number',
      prompt: 'Q',
      min: 1,
      max: 10,
    }, '8')).toBe(8)

    expect(parseStringAnswer({ type: 'confirm', prompt: 'Q', default: true }, '')).toBe(true)
    expect(parseStringAnswer({ type: 'confirm', prompt: 'Q' }, 'yes')).toBe(true)
    expect(parseStringAnswer({ type: 'confirm', prompt: 'Q' }, 'n')).toBe(false)
    expect(() => parseStringAnswer({ type: 'confirm', prompt: 'Q' }, 'maybe')).toThrow('yes/no')

    expect(parseStringAnswer({
      type: 'select',
      prompt: 'Q',
      options: ['a', 'b'],
      default: 'a',
    }, '')).toBe('a')
    expect(parseStringAnswer({
      type: 'select',
      prompt: 'Q',
      options: ['a', 'b'],
    }, 'b')).toBe('b')

    expect(parseStringAnswer({
      type: 'multi-select',
      prompt: 'Q',
      options: ['a', 'b'],
      default: ['a'],
    }, '')).toEqual(['a'])
    expect(parseStringAnswer({
      type: 'multi-select',
      prompt: 'Q',
      options: ['a', 'b'],
    }, 'a, b')).toEqual(['a', 'b'])
    expect(parseStringAnswer({
      type: 'multi-select',
      prompt: 'Q',
      options: ['a', 'b'],
    }, '')).toEqual([])
    expect(parseStringAnswer({
      type: 'multi-select',
      prompt: 'Q',
      options: ['a', 'b'],
    }, '["b"]')).toEqual(['b'])
    expect(() => parseStringAnswer({
      type: 'multi-select',
      prompt: 'Q',
      options: ['a', 'b'],
    }, '[1,2]')).toThrow()
  })
})
