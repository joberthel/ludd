import type { z } from 'zod'
import type { DynamicProperty, ProvisionedEnvironment, StepContext } from './context.js'

export type AgentAccessMode = 'read-only' | 'workspace-write'

export interface AgentTurnInput<TContext extends StepContext<any, any, any, any> = StepContext> {
  ctx: TContext
  stepId: string
  prompt: string
  sessionId: string
  attempt: number
  mode: AgentAccessMode
  dangerMode?: boolean
  runDir: string
  environment: ProvisionedEnvironment
  mcpServerUrl: string
  mcpAuthToken: string
  /**
   * The step's `outputSchema`, when declared. Adapters use it to collect structured output
   * in-turn (e.g. `piAgent`'s `submit_step_output` tool).
   */
  outputSchema?: z.ZodType
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
