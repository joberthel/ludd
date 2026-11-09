import type {
  AgentAccessMode,
  AgentRunner,
  AgentTurnInput,
  AgentTurnResult,
  DynamicProperty,
  StepContext,
} from '@ludd/core'
import { appendStreamEvent } from '@ludd/core'

export type AgentMidTurnEventType = 'thought' | 'tool_call' | 'message_chunk'

export interface MockAgentTelemetryEvent {
  eventType: AgentMidTurnEventType
  payload: Record<string, unknown>
}

export interface MockAgentTurnResultWithEvents<TOutput> {
  output: TOutput
  events?: readonly MockAgentTelemetryEvent[]
}

export type MockAgentResponse<TOutput, TContext extends StepContext<any, any, any, any> = StepContext>
  = | TOutput
    | MockAgentTurnResultWithEvents<TOutput>
    | ((
      input: AgentTurnInput<TContext>,
    ) =>
      | TOutput
      | MockAgentTurnResultWithEvents<TOutput>
      | Promise<TOutput | MockAgentTurnResultWithEvents<TOutput>>)

export interface MockAgentConfig<
  TOutput = unknown,
  TContext extends StepContext<any, any, any, any> = StepContext<any, any, any, any>,
> {
  mode?: AgentAccessMode
  prompt: DynamicProperty<string, TContext>
  sessionId?: DynamicProperty<string | undefined, TContext>
  events?: readonly MockAgentTelemetryEvent[]
  responses: readonly MockAgentResponse<TOutput, TContext>[]
}

export interface MockAgentRunner<
  TOutput = unknown,
  TContext extends StepContext<any, any, any, any> = StepContext,
> extends AgentRunner<TOutput, TContext> {
  (): void
}

function isTurnResultWithEvents<TOutput>(
  value: unknown,
): value is MockAgentTurnResultWithEvents<TOutput> {
  return (
    typeof value === 'object'
    && value !== null
    && 'output' in value
    && 'events' in value
    && Array.isArray((value as Record<string, unknown>).events)
  )
}

function emitTelemetryEvents<TContext extends StepContext<any, any, any, any>>(
  input: AgentTurnInput<TContext>,
  events: readonly MockAgentTelemetryEvent[],
): void {
  for (const event of events) {
    appendStreamEvent(input.runDir, input.sessionId, {
      schemaVersion: 1,
      timestamp: new Date().toISOString(),
      runId: input.ctx.runId,
      stepId: input.stepId,
      sessionId: input.sessionId,
      attempt: input.attempt,
      eventType: event.eventType,
      payload: event.payload,
    })
  }
}

async function resolveResponseOutput<TOutput, TContext extends StepContext<any, any, any, any>>(
  nextResponse: MockAgentResponse<TOutput, TContext>,
  input: AgentTurnInput<TContext>,
  defaultEvents?: readonly MockAgentTelemetryEvent[],
): Promise<{ output: TOutput, events?: readonly MockAgentTelemetryEvent[] }> {
  const resolved = typeof nextResponse === 'function'
    ? await (nextResponse as (input: AgentTurnInput<TContext>) => unknown)(input)
    : nextResponse

  if (isTurnResultWithEvents<TOutput>(resolved)) {
    return { output: resolved.output, events: resolved.events }
  }
  return { output: resolved as TOutput, events: defaultEvents }
}

export function mockAgent<
  TOutput = unknown,
  TContext extends StepContext<any, any, any, any> = StepContext,
>(config: MockAgentConfig<TOutput, TContext>): MockAgentRunner<TOutput, TContext> {
  const responses = config?.responses
  if (!Array.isArray(responses) || responses.length === 0) {
    throw new Error('mockAgent requires a non-empty "responses" array.')
  }

  const scriptedResponses: MockAgentResponse<TOutput, TContext>[] = [...config.responses]
  let callIndex = 0

  return {
    __kind: 'agent',
    mode: config.mode ?? 'read-only',
    prompt: config.prompt,
    sessionId: config.sessionId,
    executeTurn: async (input: AgentTurnInput<TContext>): Promise<AgentTurnResult<TOutput>> => {
      if (callIndex >= scriptedResponses.length) {
        throw new Error(
          `mockAgent scripted responses exhausted: received call ${callIndex + 1} but only ${scriptedResponses.length} responses configured.`,
        )
      }

      const nextResponse = scriptedResponses[callIndex]
      callIndex += 1

      const { output, events } = await resolveResponseOutput(
        nextResponse,
        input,
        config.events,
      )

      if (events && events.length > 0) {
        emitTelemetryEvents(input, events)
      }

      return {
        output,
        sessionId: input.sessionId,
      }
    },
  } as unknown as MockAgentRunner<TOutput, TContext>
}
