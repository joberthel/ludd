import type { z } from 'zod'
import type {
  AgentAccessMode,
  AgentRunner,
  AgentStepOutput,
  AgentTurnInput,
  AgentTurnResult,
} from './agent.js'
import type { ArtifactValidationRule } from './artifact.js'
import type { DynamicProperty, EnvironmentAdapter, ProvisionedEnvironment, StepContext, StepResult } from './context.js'
import type { Guardrail, OnMaxRetriesExceededAction } from './guardrail.js'

export { isGuardrail } from './guardrail.js'
export type { OnMaxRetriesExceededAction } from './guardrail.js'

export type {
  AgentAccessMode,
  AgentRunner,
  AgentStepOutput,
  AgentTurnInput,
  AgentTurnResult,
}

export type {
  AccumulateArtifactItemMap,
  AccumulatePriorSteps,
  ArtifactMatrixStepDef,
  DerivedStepContext,
  InferArrayItem,
  InferMatrixItem,
  InferSingleStepOutput,
  InferStepOutput,
  ItemsMatrixStepDef,
  PlainStepDef,
  PriorStepContext,
  StepArtifactItemMap,
  StepHasMatrix,
  StepTupleEntry,
  TypedStep,
} from './inference.js'

export type CleanupPolicyAction = 'keep' | 'destroy'

export interface CleanupPolicy {
  onSuccess?: CleanupPolicyAction
  onFailure?: CleanupPolicyAction
}

export interface StepRunFn<
  TOutput = unknown,
  TContext extends StepContext<any, any, any, any> = StepContext,
> {
  (ctx: TContext): TOutput | Promise<TOutput>
  readonly __context?: TContext
}

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

export interface MatrixItemsConfig<TItem = unknown, TContext extends StepContext = StepContext> {
  items: DynamicProperty<readonly TItem[], TContext>
  itemsFromArtifact?: never
}

export interface MatrixArtifactConfig<TArtifactKey extends string = string> {
  items?: never
  itemsFromArtifact: TArtifactKey
}

export type MatrixConfig<
  TItem = unknown,
  TContext extends StepContext = StepContext,
  TArtifactKey extends string = string,
> = MatrixItemsConfig<TItem, TContext> | MatrixArtifactConfig<TArtifactKey>

export interface StepConfig<
  TId extends string = string,
  TOutput = unknown,
  TContext extends StepContext = StepContext,
  TMatrixContext extends StepContext = StepContext,
  TArtifacts extends Record<string, ArtifactValidationRule<any>> = Record<string, ArtifactValidationRule<any>>,
  TMatrixItem = unknown,
  TArtifactKey extends string = string,
> {
  id: TId
  name?: string
  dangerMode?: boolean
  if?: (ctx: TMatrixContext) => boolean | Promise<boolean>
  environment?: DynamicProperty<ProvisionedEnvironment | EnvironmentAdapter, TContext>
  matrix?: MatrixConfig<TMatrixItem, TMatrixContext, TArtifactKey>
  outputSchema?: z.ZodType<TOutput>
  maxTotalTurns?: number
  onMaxRetriesExceeded?: OnMaxRetriesExceededAction
  artifacts?: TArtifacts
  beforeStep?: readonly Guardrail<any, any>[]
  afterStep?: readonly Guardrail<any, any>[]
  run: StepRunFn<TOutput, TContext> | AgentRunner<TOutput, TContext>
}

export interface HarnessConfig<
  TSteps extends readonly StepConfig<any, any, any, any, any, any, any>[] = readonly StepConfig[],
  TName extends string = string,
> {
  name: TName
  cleanupPolicy?: CleanupPolicy
  steps: TSteps
}

export interface RunHarnessOptions {
  runId?: string
  workspaceDir?: string
  signal?: AbortSignal
}

export interface HarnessRunResult {
  runId: string
  status: 'passed' | 'failed'
  steps: Record<string, StepResult<unknown>>
  failedStepId?: string
  error?: unknown
}
