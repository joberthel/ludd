import type { AgentRunner } from '../types/agent.js'
import { describe, expect, it } from 'vitest'
import { isAgentRunner } from '../types/harness.js'

describe('isAgentRunner valid runner checks', () => {
  it('returns true for valid AgentRunner with string prompt and read-only mode', () => {
    const runner: AgentRunner = {
      __kind: 'agent',
      mode: 'read-only',
      prompt: 'summarize',
      executeTurn: async () => ({ output: 'done', sessionId: 's-1' }),
    }
    expect(isAgentRunner(runner)).toBe(true)
  })

  it('returns true for valid AgentRunner with dynamic prompt and workspace-write mode', () => {
    const runner: AgentRunner = {
      __kind: 'agent',
      mode: 'workspace-write',
      prompt: () => 'dynamic prompt',
      sessionId: 'session-custom',
      executeTurn: async () => ({ output: 'written', sessionId: 'session-custom' }),
    }
    expect(isAgentRunner(runner)).toBe(true)
  })
})

describe('isAgentRunner invalid values and shapes', () => {
  it('returns false for primitives and null', () => {
    expect(isAgentRunner(null)).toBe(false)
    expect(isAgentRunner(undefined)).toBe(false)
    expect(isAgentRunner('agent')).toBe(false)
    expect(isAgentRunner(123)).toBe(false)
    expect(isAgentRunner(true)).toBe(false)
  })

  it('returns false for objects missing required properties or having invalid properties', () => {
    expect(isAgentRunner({})).toBe(false)
    expect(isAgentRunner({ __kind: 'other' })).toBe(false)
    expect(isAgentRunner({ __kind: 'agent' })).toBe(false)
    expect(isAgentRunner({
      __kind: 'agent',
      mode: 'invalid-mode',
      prompt: 'hello',
      executeTurn: () => {},
    })).toBe(false)
    expect(isAgentRunner({
      __kind: 'agent',
      mode: 'read-only',
      prompt: 123,
      executeTurn: () => {},
    })).toBe(false)
    expect(isAgentRunner({
      __kind: 'agent',
      mode: 'read-only',
      prompt: 'hello',
      executeTurn: 'not-a-function',
    })).toBe(false)
  })
})
