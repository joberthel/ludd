import { expect, it } from 'vitest'
import { flag, parse, text } from './parse-args.js'

it('parses flags and string options cleanly', () => {
  const parsed = parse(['--name', 'alice', '--verbose', 'pos'], {
    name: { type: 'string' },
    verbose: { type: 'boolean' },
  })
  expect(text(parsed.values, 'name')).toBe('alice')
  expect(text(parsed.values, 'missing')).toBeUndefined()
  expect(flag(parsed.values, 'verbose')).toBe(true)
  expect(flag(parsed.values, 'missing')).toBe(false)
  expect(parsed.positionals).toEqual(['pos'])
})
