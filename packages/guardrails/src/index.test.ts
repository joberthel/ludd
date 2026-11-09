import { describe, expect, it } from 'vitest'
import * as guardrails from './index.js'

describe('@ludd/guardrails package index', () => {
  it('exports fnGuardrail function', () => {
    expect(typeof guardrails.fnGuardrail).toBe('function')
  })
})
