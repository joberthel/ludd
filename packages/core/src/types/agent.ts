import type { DynamicProperty, StepContext } from './context.js'

export type AgentAccessMode = 'read-only' | 'workspace-write'

export interface AgentTurnInput<TContext = StepContext> {
  ctx: TContext
  stepId: string
  prompt: string
  sessionId: string
  attempt: number
  mode: AgentAccessMode
  runDir: string
  mcpServerUrl: string
  mcpAuthToken: string
}

export interface AgentTurnResult<TOutput = unknown> {
  output: TOutput
  sessionId: string
}

export type AgentStepOutput<TOutput>
  = TOutput extends Record<string, unknown>
    ? TOutput & { sessionId: string }
    : { value: TOutput, sessionId: string }

export interface AgentRunner<
  TOutput = unknown,
  TContext extends StepContext = StepContext,
> {
  readonly __kind: 'agent'
  readonly mode: AgentAccessMode
  readonly prompt: DynamicProperty<string, TContext>
  readonly sessionId?: DynamicProperty<string | undefined, TContext>
  executeTurn: (input: AgentTurnInput<TContext>) => Promise<AgentTurnResult<TOutput>>
}
