import { describe, expect, it } from 'vitest'
import * as guardrails from './index.js'

describe('@ludd/guardrails package index', () => {
  it('exports guardrail functions and template utilities', () => {
    expect(typeof guardrails.agentGuardrail).toBe('function')
    expect(typeof guardrails.fnGuardrail).toBe('function')
    expect(typeof guardrails.execGuardrail).toBe('function')
    expect(typeof guardrails.humanReviewGuardrail).toBe('function')
    expect(typeof guardrails.sh).toBe('function')
  })
})
