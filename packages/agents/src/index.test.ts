import type {
  AgentMcpConnection,
  AgentStreamEvent,
  AgentStreamEventType,
} from './index.js'
import { describe, expect, it } from 'vitest'
import * as agents from './index.js'

describe('@luddjs/agents public exports', () => {
  it('exports mockAgent factory and stream utilities', () => {
    expect(typeof agents.mockAgent).toBe('function')
    expect(typeof agents.appendStreamEvent).toBe('function')
    expect(typeof agents.readStreamEvents).toBe('function')
    expect(typeof agents.resolveStreamPath).toBe('function')
  })

  it('exposes stream and MCP connection type contracts', () => {
    const mcp: AgentMcpConnection = {
      url: 'http://127.0.0.1:4000/mcp',
      authToken: 'secret',
    }
    const streamType: AgentStreamEventType = 'thought'
    const streamEvent: AgentStreamEvent = {
      schemaVersion: 1,
      timestamp: new Date().toISOString(),
      runId: 'r-1',
      stepId: 's-1',
      sessionId: 'sess-1',
      attempt: 1,
      eventType: streamType,
      payload: { note: 'planning' },
    }

    expect(mcp.url).toBe('http://127.0.0.1:4000/mcp')
    expect(streamEvent.eventType).toBe('thought')
    expect(streamEvent.schemaVersion).toBe(1)
  })
})
