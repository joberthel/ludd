import type {
  AgentMidTurnEventType,
  AgentStreamEvent,
  AgentStreamEventType,
  MockAgentTelemetryEvent,
  MockAgentTurnResultWithEvents,
} from './index.js'
import { describe, expect, it } from 'vitest'
import * as agents from './index.js'

describe('@ludd/agents public exports', () => {
  it('exports mockAgent factory and stream utilities', () => {
    expect(typeof agents.mockAgent).toBe('function')
    expect(typeof agents.appendStreamEvent).toBe('function')
    expect(typeof agents.readStreamEvents).toBe('function')
    expect(typeof agents.resolveStreamPath).toBe('function')
  })

  it('exposes telemetry type contracts', () => {
    const midTurnType: AgentMidTurnEventType = 'thought'
    const streamType: AgentStreamEventType = 'thought'
    const midTurnEvent: MockAgentTelemetryEvent = {
      eventType: midTurnType,
      payload: { note: 'planning' },
    }
    const turnResultWithEvents: MockAgentTurnResultWithEvents<string> = {
      output: 'done',
      events: [midTurnEvent],
    }
    const streamEvent: AgentStreamEvent = {
      schemaVersion: 1,
      timestamp: new Date().toISOString(),
      runId: 'r-1',
      stepId: 's-1',
      sessionId: 'sess-1',
      attempt: 1,
      eventType: streamType,
      payload: midTurnEvent.payload,
    }

    expect(midTurnEvent.eventType).toBe('thought')
    expect(turnResultWithEvents.output).toBe('done')
    expect(streamEvent.schemaVersion).toBe(1)
  })
})
