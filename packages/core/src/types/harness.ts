import type { z } from 'zod'
import type { AgentAccessMode, AgentRunner, AgentTurnInput, AgentTurnResult } from './agent.js'
import type { StepContext } from './context.js'

export type { AgentAccessMode, AgentRunner, AgentTurnInput, AgentTurnResult }

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
  run: StepRunFn<TOutput> | AgentRunner<TOutput>
}

export interface HarnessConfig<
  TSteps extends readonly StepConfig<any, any>[] = readonly StepConfig<any, any>[],
> {
  name: string
  cleanupPolicy?: CleanupPolicy
  steps: TSteps
}
