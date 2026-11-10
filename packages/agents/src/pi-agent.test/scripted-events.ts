function textDelta(type: string, delta: string) {
  return {
    type: 'message_update',
    assistantMessageEvent: { type, delta },
  }
}

export function scriptedEvents() {
  return [
    textDelta('thinking_delta', 'hm'),
    textDelta('text_delta', 'hi'),
    {
      type: 'message_update',
      assistantMessageEvent: { type: 'text_start' },
    },
    { type: 'message_update' },
    {
      type: 'tool_execution_start',
      toolCallId: 't1',
      toolName: 'read',
      args: { p: 1 },
    },
    {
      type: 'tool_execution_update',
      toolCallId: 't1',
      toolName: 'read',
      partialResult: 'x',
    },
    {
      type: 'tool_execution_end',
      toolCallId: 't1',
      toolName: 'read',
      result: 'r',
      isError: false,
    },
    { type: 'turn_end' },
    { type: 'agent_settled', aborted: false },
  ]
}
