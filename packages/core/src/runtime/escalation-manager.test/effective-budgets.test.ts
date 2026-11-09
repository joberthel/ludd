import type { Guardrail } from '../../types/guardrail.js'
import type { RunStateSnapshot } from '../../types/state.js'
import { describe, expect, it } from 'vitest'
import {
  getEffectiveMaxRetries,
  getEffectiveMaxTotalTurns,
  resolveAddRetries,
} from '../escalation-manager.js'

function makeSnapshot(
  extraRetries?: Record<string, number>,
  extraTurns?: Record<string, number>,
): RunStateSnapshot {
  return {
    schemaVersion: 1,
    runId: 'r-budgets',
    harnessName: 'test',
    status: 'running',
    activeStepId: 'step-1',
    grantedExtraRetries: extraRetries,
    grantedExtraTurns: extraTurns,
    steps: {},
    updatedAt: new Date().toISOString(),
  }
}

describe('getEffectiveMaxRetries', () => {
  it('returns POSITIVE_INFINITY for human_review with undefined maxRetries', () => {
    const rail: Guardrail = {
      __kind: 'guardrail',
      type: 'human_review',
      execute: async () => ({ status: 'pass' }),
    }
    const snapshot = makeSnapshot({ 'step-1:0': 5 })
    expect(getEffectiveMaxRetries(rail, 'step-1', 0, snapshot)).toBe(Number.POSITIVE_INFINITY)
  })

  it('calculates base retries plus granted extra retries', () => {
    const railWithRetries: Guardrail = {
      __kind: 'guardrail',
      type: 'fn',
      maxRetries: 2,
      execute: async () => ({ status: 'pass' }),
    }
    const railWithoutRetries: Guardrail = {
      __kind: 'guardrail',
      type: 'fn',
      execute: async () => ({ status: 'pass' }),
    }

    const snapshot = makeSnapshot({ 'step-1:0': 3 })
    expect(getEffectiveMaxRetries(railWithRetries, 'step-1', 0, snapshot)).toBe(5)
    expect(getEffectiveMaxRetries(railWithoutRetries, 'step-1', 0, snapshot)).toBe(3)
    expect(getEffectiveMaxRetries(railWithRetries, 'step-1', 1, snapshot)).toBe(2)
  })

  it('handles undefined grantedExtraRetries gracefully', () => {
    const rail: Guardrail = {
      __kind: 'guardrail',
      type: 'fn',
      maxRetries: 1,
      execute: async () => ({ status: 'pass' }),
    }
    const snapshot = makeSnapshot()
    expect(getEffectiveMaxRetries(rail, 'step-1', 0, snapshot)).toBe(1)
  })
})

describe('getEffectiveMaxTotalTurns', () => {
  it('calculates base turns plus granted extra turns', () => {
    const snapshot = makeSnapshot(undefined, { 'step-1': 4 })
    expect(getEffectiveMaxTotalTurns(10, 'step-1', snapshot)).toBe(14)
    expect(getEffectiveMaxTotalTurns(10, 'other-step', snapshot)).toBe(10)
  })

  it('handles undefined grantedExtraTurns gracefully', () => {
    const snapshot = makeSnapshot()
    expect(getEffectiveMaxTotalTurns(15, 'step-1', snapshot)).toBe(15)
  })
})

describe('resolveAddRetries', () => {
  it('defaults to 1 when undefined', () => {
    expect(resolveAddRetries(undefined)).toBe(1)
  })

  it('accepts positive integers', () => {
    expect(resolveAddRetries(1)).toBe(1)
    expect(resolveAddRetries(5)).toBe(5)
  })

  it('throws on non-integers, numbers < 1, or NaN', () => {
    expect(() => resolveAddRetries(0)).toThrow('Invalid addRetries: expected integer >= 1, received 0')
    expect(() => resolveAddRetries(-2)).toThrow('Invalid addRetries: expected integer >= 1, received -2')
    expect(() => resolveAddRetries(1.5)).toThrow('Invalid addRetries: expected integer >= 1, received 1.5')
    expect(() => resolveAddRetries(Number.NaN)).toThrow('Invalid addRetries: expected integer >= 1')
  })
})
