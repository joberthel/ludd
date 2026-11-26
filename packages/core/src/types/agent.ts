import type { z } from 'zod'
import type { DynamicProperty, StepContext } from './context.js'

export type AgentAccessMode = 'read-only' | 'workspace-write'

/** Connection metadata for the embedded core MCP server passed to agent turns. */
export interface AgentMcpConnection {
  url: string
  authToken: string
}

export interface AgentTurnInput<TContext extends StepContext<any, any, any, any> = StepContext> {
  ctx: TContext
  stepId: string
  prompt: string
  sessionId: string
  /** Existing session ID to resume when continuing a previous turn, retrying, or rehydrating. */
  previousSessionId?: string
  attempt: number
  mode: AgentAccessMode
  runDir: string
  /** Resolved working directory on the host for this step/turn. */
  cwd: string
  /** Resolved environment variables for this step/turn. */
  env: Record<string, string>
  /** Embedded MCP server connection metadata when an MCP server is available for this turn. */
  mcp?: AgentMcpConnection
  /**
   * The step's `outputSchema`, when declared. Adapters use it to collect and validate
   * structured output for the turn.
   */
  outputSchema?: z.ZodType
  /** True when the step has `interactive` mode enabled and `ask_user` MCP tool should be exposed. */
  interactive?: boolean
  /** Fires when the run is aborted (e.g. via IPC `run.abort`). */
  signal?: AbortSignal
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
  TContext extends StepContext<any, any, any, any> = StepContext,
> {
  readonly __kind: 'agent'
  readonly mode: AgentAccessMode
  readonly prompt: DynamicProperty<string, any>
  readonly sessionId?: DynamicProperty<string | undefined, any>
  readonly __context?: TContext
  executeTurn: (input: AgentTurnInput<any>) => Promise<AgentTurnResult<TOutput>>
}
