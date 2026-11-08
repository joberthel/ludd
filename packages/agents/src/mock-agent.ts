import type {
  AgentAccessMode,
  AgentRunner,
  AgentTurnInput,
  AgentTurnResult,
  DynamicProperty,
  StepContext,
} from '@ludd/core'

export type MockAgentResponse<TOutput, TContext = StepContext>
  = | TOutput
    | ((input: AgentTurnInput<TContext>) => TOutput | Promise<TOutput>)

export interface MockAgentConfig<
  TOutput = unknown,
  TContext extends StepContext = StepContext,
> {
  mode?: AgentAccessMode
  prompt: DynamicProperty<string, TContext>
  sessionId?: DynamicProperty<string | undefined, TContext>
  responses: readonly MockAgentResponse<TOutput, TContext>[]
}

export function mockAgent<
  TOutput = unknown,
  TContext extends StepContext = StepContext,
>(config: MockAgentConfig<TOutput, TContext>): AgentRunner<TOutput, TContext> {
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

      const output: TOutput = typeof nextResponse === 'function'
        ? await (nextResponse as (input: AgentTurnInput<TContext>) => TOutput | Promise<TOutput>)(input)
        : nextResponse

      return {
        output,
        sessionId: input.sessionId,
      }
    },
  }
}
