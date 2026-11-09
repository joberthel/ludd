import type { Guardrail, GuardrailVerdict } from '../../types/guardrail.js'
import type { StepConfig } from '../../types/harness.js'
import { describe, expect, it } from 'vitest'
import {
  determineEscalationPolicy,
  formatEscalationPrompt,
} from '../escalation-manager.js'

describe('determineEscalationPolicy precedence', () => {
  it('prefers guardrail onMaxRetriesExceeded over step', () => {
    const rail: Guardrail = {
      __kind: 'guardrail',
      type: 'fn',
      onMaxRetriesExceeded: 'prompt_user',
      execute: async () => ({ status: 'pass' }),
    }
    const step: StepConfig = {
      id: 'step-1',
      onMaxRetriesExceeded: 'abort',
      run: () => {},
    }
    expect(determineEscalationPolicy(rail, step)).toBe('prompt_user')
  })

  it('falls back to step onMaxRetriesExceeded if rail has none', () => {
    const rail: Guardrail = {
      __kind: 'guardrail',
      type: 'fn',
      execute: async () => ({ status: 'pass' }),
    }
    const step: StepConfig = {
      id: 'step-1',
      onMaxRetriesExceeded: 'prompt_user',
      run: () => {},
    }
    expect(determineEscalationPolicy(rail, step)).toBe('prompt_user')
  })

  it('defaults to abort when neither defines onMaxRetriesExceeded', () => {
    const rail: Guardrail = {
      __kind: 'guardrail',
      type: 'fn',
      execute: async () => ({ status: 'pass' }),
    }
    const step: StepConfig = {
      id: 'step-1',
      run: () => {},
    }
    expect(determineEscalationPolicy(rail, step)).toBe('abort')
  })
})

describe('formatEscalationPrompt', () => {
  it('formats prompt for guardrail_max_retries with string body and logKey', () => {
    const verdict: GuardrailVerdict = {
      status: 'fail',
      body: 'Tests failed with 3 errors',
      logKey: 'logs/step-1/guardrail-0.txt',
    }
    const prompt = formatEscalationPrompt('step-1', 0, verdict, 'guardrail_max_retries')
    expect(prompt).toContain('Guardrail #0 in step "step-1" exceeded maxRetries.')
    expect(prompt).toContain('Summary: Tests failed with 3 errors')
    expect(prompt).toContain('MCP logKey: "logs/step-1/guardrail-0.txt"')
    expect(prompt).toContain('Choose pass, skip, or abort.')
  })

  it('formats prompt for max_total_turns with object body', () => {
    const verdict: GuardrailVerdict = {
      status: 'fail',
      body: { code: 1, signal: 'SIGTERM' },
    }
    const prompt = formatEscalationPrompt('step-2', 1, verdict, 'max_total_turns')
    expect(prompt).toContain('Step "step-2" exceeded maxTotalTurns at guardrail #1.')
    expect(prompt).toContain('Summary: {"code":1,"signal":"SIGTERM"}')
    expect(prompt).not.toContain('MCP logKey')
    expect(prompt).toContain('Choose pass, skip, or abort.')
  })

  it('formats prompt when body is omitted', () => {
    const verdict: GuardrailVerdict = { status: 'fail' }
    const prompt = formatEscalationPrompt('step-3', 2, verdict, 'guardrail_max_retries')
    expect(prompt).toContain('Guardrail #2 in step "step-3" exceeded maxRetries.')
    expect(prompt).not.toContain('Summary:')
    expect(prompt).toContain('Choose pass, skip, or abort.')
  })
})
