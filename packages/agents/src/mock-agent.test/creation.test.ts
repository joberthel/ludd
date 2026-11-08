import { isAgentRunner } from '@ludd/core'
import { describe, expect, it } from 'vitest'
import { mockAgent } from '../mock-agent.js'

describe('mockAgent creation and configuration', () => {
  it('creates an agent runner matching isAgentRunner contract', () => {
    const agent = mockAgent({
      prompt: 'test prompt',
      responses: ['first response'],
    })
    expect(isAgentRunner(agent)).toBe(true)
    expect(agent.__kind).toBe('agent')
    expect(agent.mode).toBe('read-only')
    expect(agent.prompt).toBe('test prompt')
    expect(agent.sessionId).toBeUndefined()
  })

  it('supports custom mode and custom sessionId', () => {
    const agent = mockAgent({
      mode: 'workspace-write',
      prompt: () => 'dynamic prompt',
      sessionId: 'session-xyz',
      responses: ['ok'],
    })
    expect(agent.mode).toBe('workspace-write')
    expect(agent.sessionId).toBe('session-xyz')
    expect(typeof agent.prompt).toBe('function')
  })

  it('rejects empty or non-array responses configuration', () => {
    expect(() => mockAgent({ prompt: 'test', responses: [] } as any)).toThrow(
      'mockAgent requires a non-empty "responses" array.',
    )
    expect(() => mockAgent({ prompt: 'test' } as any)).toThrow(
      'mockAgent requires a non-empty "responses" array.',
    )
    expect(() => mockAgent(null as any)).toThrow(
      'mockAgent requires a non-empty "responses" array.',
    )
  })
})
