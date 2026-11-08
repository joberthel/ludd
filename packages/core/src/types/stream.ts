export type AgentStreamEventType
  = | 'turn.started'
    | 'thought'
    | 'tool_call'
    | 'message_chunk'
    | 'turn.completed'

export interface AgentStreamEvent<TPayload = Record<string, unknown>> {
  schemaVersion: 1
  timestamp: string
  runId: string
  stepId: string
  sessionId: string
  attempt: number
  eventType: AgentStreamEventType
  payload: TPayload
}
