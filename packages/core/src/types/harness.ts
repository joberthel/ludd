import type { z } from 'zod'
import type {
  AgentAccessMode,
  AgentRunner,
  AgentStepOutput,
  AgentTurnInput,
  AgentTurnResult,
} from './agent.js'
import type { StepContext, StepResult } from './context.js'

export type {
  AgentAccessMode,
  AgentRunner,
  AgentStepOutput,
  AgentTurnInput,
  AgentTurnResult,
}

export type CleanupPolicyAction = 'keep' | 'destroy'

export interface CleanupPolicy {
  onSuccess?: CleanupPolicyAction
  onFailure?: CleanupPolicyAction
}

export type StepRunFn<
  TOutput = unknown,
  TContext extends StepContext = StepContext,
> = (ctx: TContext) => TOutput | Promise<TOutput>

export function isAgentRunner(value: unknown): value is AgentRunner {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const candidate = value as Record<string, unknown>
  const hasValidKind = candidate.__kind === 'agent'
  const hasValidMode = candidate.mode === 'read-only' || candidate.mode === 'workspace-write'
  const hasValidPrompt = typeof candidate.prompt === 'string' || typeof candidate.prompt === 'function'
  const hasValidExecuteTurn = typeof candidate.executeTurn === 'function'
  return hasValidKind && hasValidMode && hasValidPrompt && hasValidExecuteTurn
}

export interface StepConfig<TId extends string = string, TOutput = unknown> {
  id: TId
  name?: string
  if?: (ctx: StepContext) => boolean | Promise<boolean>
  outputSchema?: z.ZodType<TOutput>
  maxTotalTurns?: number
  run: StepRunFn<TOutput> | AgentRunner<TOutput>
}

export type InferStepOutput<TStep>
  = TStep extends { run: { readonly __kind: 'agent' } | AgentRunner<any>, outputSchema: z.ZodType<infer TSchemaOutput> }
    ? AgentStepOutput<TSchemaOutput>
    : TStep extends { run: AgentRunner<infer TRunnerOutput> }
      ? AgentStepOutput<TRunnerOutput>
      : TStep extends { run: { readonly __kind: 'agent' } }
        ? AgentStepOutput<unknown>
        : TStep extends { outputSchema: z.ZodType<infer TSchemaOutput> }
          ? TSchemaOutput
          : TStep extends { run: (...args: any[]) => infer TReturn }
            ? Awaited<TReturn>
            : TStep extends StepConfig<string, infer TOutput>
              ? TOutput
              : unknown

export interface HarnessConfig<
  TSteps extends readonly StepConfig<any, any>[] = readonly StepConfig<any, any>[],
> {
  name: string
  cleanupPolicy?: CleanupPolicy
  steps: TSteps
}

export interface RunHarnessOptions {
  runId?: string
  workspaceDir?: string
}

export interface HarnessRunResult {
  runId: string
  status: 'passed' | 'failed'
  steps: Record<string, StepResult<unknown>>
  failedStepId?: string
  error?: unknown
}
