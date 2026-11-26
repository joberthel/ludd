import type { SessionNotification, SessionUpdate, ToolCall, ToolCallUpdate } from '@agentclientprotocol/sdk'
import type { AgentStreamEventType, AgentTurnInput, StepContext } from '@luddjs/core'
import { appendStreamEvent } from '@luddjs/core'

interface MappedStreamEvent {
  eventType: AgentStreamEventType
  payload: Record<string, unknown>
  assistantText?: string
}

const SAFE_STREAM_KEY_RE = /^[\w.-]+$/

function resolveSafeStreamKey(rawSessionId: string, fallbackSessionId: string): string {
  if (SAFE_STREAM_KEY_RE.test(rawSessionId) && rawSessionId !== '.' && rawSessionId !== '..') {
    return rawSessionId
  }
  const sanitized = rawSessionId.replace(/[^\w.-]/g, '_').replace(/^\.+$/, '')
  return sanitized !== ''
    ? sanitized
    : fallbackSessionId
}

function mapToolCallEvent(update: ToolCall): MappedStreamEvent {
  return {
    eventType: 'tool_call',
    payload: {
      phase: 'start',
      toolCallId: update.toolCallId,
      toolName: update.name ?? update.title,
      title: update.title,
      kind: update.kind,
      status: update.status,
      rawInput: update.rawInput,
    },
  }
}

function mapToolCallUpdateEvent(update: ToolCallUpdate): MappedStreamEvent {
  const phase = update.status === 'completed' || update.status === 'failed'
    ? 'end'
    : 'update'
  return {
    eventType: 'tool_call',
    payload: {
      phase,
      toolCallId: update.toolCallId,
      toolName: update.name ?? update.title,
      title: update.title,
      kind: update.kind,
      status: update.status,
      rawInput: update.rawInput,
      rawOutput: update.rawOutput,
    },
  }
}

function mapSessionUpdate(update: SessionUpdate): MappedStreamEvent | undefined {
  if (update.sessionUpdate === 'agent_message_chunk') {
    return update.content.type === 'text'
      ? {
          eventType: 'message_chunk',
          payload: { text: update.content.text },
          assistantText: update.content.text,
        }
      : undefined
  }
  if (update.sessionUpdate === 'agent_thought_chunk') {
    return update.content.type === 'text'
      ? {
          eventType: 'thought',
          payload: { text: update.content.text },
        }
      : undefined
  }
  if (update.sessionUpdate === 'tool_call') {
    return mapToolCallEvent(update)
  }
  if (update.sessionUpdate === 'tool_call_update') {
    return mapToolCallUpdateEvent(update)
  }
  return undefined
}

/** Creates a stateful notification handler that persists ACP `session/update` events and accumulates assistant text. */
export function createSessionUpdateCollector(input: AgentTurnInput<any>): {
  onNotification: (notification: SessionNotification) => void
  getAssistantText: () => string
} {
  let assistantText = ''

  const onNotification = (notification: SessionNotification): void => {
    const mapped = mapSessionUpdate(notification.update)
    if (mapped === undefined) {
      return
    }
    if (mapped.assistantText !== undefined) {
      assistantText += mapped.assistantText
    }
    const streamKey = resolveSafeStreamKey(notification.sessionId, input.sessionId)
    appendStreamEvent(input.runDir, streamKey, {
      schemaVersion: 1,
      timestamp: new Date().toISOString(),
      runId: (input.ctx as StepContext).runId,
      stepId: input.stepId,
      sessionId: notification.sessionId,
      attempt: input.attempt,
      eventType: mapped.eventType,
      payload: mapped.payload,
    })
  }

  return {
    onNotification,
    getAssistantText: () => assistantText,
  }
}
