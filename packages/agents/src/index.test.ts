import { describe, expect, it } from 'vitest'
import * as agents from './index.js'

describe('@ludd/agents public exports', () => {
  it('exports mockAgent factory function', () => {
    expect(typeof agents.mockAgent).toBe('function')
  })
})
