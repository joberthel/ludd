import type { z } from 'zod'
import type { StepContext } from './context.js'

export type CleanupPolicyAction = 'keep' | 'destroy'

export interface CleanupPolicy {
  onSuccess?: CleanupPolicyAction
  onFailure?: CleanupPolicyAction
}

export type StepRunFn<
  TOutput = unknown,
  TContext extends StepContext = StepContext,
> = (ctx: TContext) => TOutput | Promise<TOutput>

export interface AgentRunner<
  TOutput = unknown,
  TContext extends StepContext = StepContext,
> {
  readonly __kind: 'agent'
  execute: (ctx: TContext) => Promise<TOutput>
}

export function isAgentRunner(value: unknown): value is AgentRunner {
  return (
    typeof value === 'object'
    && value !== null
    && '__kind' in value
    && value.__kind === 'agent'
    && 'execute' in value
    && typeof value.execute === 'function'
  )
}

export interface StepConfig<TId extends string = string, TOutput = unknown> {
  id: TId
  name?: string
  if?: (ctx: StepContext) => boolean | Promise<boolean>
  outputSchema?: z.ZodType<TOutput, z.ZodTypeDef, unknown>
  run: StepRunFn<TOutput> | AgentRunner<TOutput>
}

export interface HarnessConfig<
  TSteps extends readonly StepConfig<any, any>[] = readonly StepConfig<any, any>[],
> {
  name: string
  cleanupPolicy?: CleanupPolicy
  steps: TSteps
}
