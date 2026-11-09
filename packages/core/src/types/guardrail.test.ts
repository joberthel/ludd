import { describe, expect, it } from 'vitest'
import { isGuardrail } from './guardrail.js'

describe('isGuardrail negative checks', () => {
  it('returns false for non-objects or null', () => {
    expect(isGuardrail(null)).toBe(false)
    expect(isGuardrail(undefined)).toBe(false)
    expect(isGuardrail('guardrail')).toBe(false)
    expect(isGuardrail(42)).toBe(false)
    expect(isGuardrail(true)).toBe(false)
    expect(isGuardrail(Symbol('guardrail'))).toBe(false)
  })

  it('returns false for arrays or empty objects', () => {
    expect(isGuardrail([])).toBe(false)
    expect(isGuardrail({})).toBe(false)
  })

  it('returns false when __kind is not "guardrail"', () => {
    expect(isGuardrail({
      __kind: 'agent',
      type: 'fn',
      execute: async () => ({ status: 'pass' }),
    })).toBe(false)
  })

  it('returns false when type is not one of fn, exec, agent, human_review', () => {
    expect(isGuardrail({
      __kind: 'guardrail',
      type: 'invalid_type',
      execute: async () => ({ status: 'pass' }),
    })).toBe(false)
  })

  it('returns false when execute is not a function', () => {
    expect(isGuardrail({
      __kind: 'guardrail',
      type: 'fn',
      execute: 'not_a_function',
    })).toBe(false)
  })
})

describe('isGuardrail positive checks', () => {
  it('returns true for valid guardrail objects of each type', () => {
    const types = ['fn', 'exec', 'agent', 'human_review'] as const
    for (const type of types) {
      expect(isGuardrail({
        __kind: 'guardrail',
        type,
        execute: async () => ({ status: 'pass' as const }),
      })).toBe(true)
    }
  })

  it('returns true for guardrail with optional properties', () => {
    expect(isGuardrail({
      __kind: 'guardrail',
      type: 'fn',
      maxRetries: 3,
      onMaxRetriesExceeded: 'prompt_user',
      environment: { id: 'env-1' },
      execute: async () => ({ status: 'pass' as const }),
    })).toBe(true)
  })
})
