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

/** A context-aware factory for constructing an agent runner at step execution time. */
export interface StepRunFactory<
  TContext extends StepContext<any, any, any, any> = StepContext,
> {
  (ctx: TContext): AgentRunner<any, TContext> | Promise<AgentRunner<any, TContext>>
  readonly __context?: TContext
}

/** An inferred map/tuple of before-step guardrail verdict bodies. */
export type BeforeStepResults<TDeclaration> = TDeclaration extends (...args: any[]) => infer TReturn
  ? BeforeStepResults<Awaited<TReturn>>
  : TDeclaration extends readonly unknown[]
    ? { -readonly [K in keyof TDeclaration]: TDeclaration[K] extends Guardrail<infer TBody, any> ? TBody : never }
    : TDeclaration extends Record<string, unknown>
      ? { [K in keyof TDeclaration]: TDeclaration[K] extends Guardrail<infer TBody, any> ? TBody : never }
      : never

/** Static guardrail arrays/maps, or a typed context factory returning them. */
export type BeforeStepGuardrailSet = readonly Guardrail<any, any>[] | Readonly<Record<string, Guardrail<any, any>>>
export type BeforeStepGuardrails<TContext extends StepContext<any, any, any, any> = StepContext>
  = BeforeStepGuardrailSet | ((ctx: TContext) => BeforeStepGuardrailSet | Promise<BeforeStepGuardrailSet>)

/** Static after-step guardrails, or a factory that receives the typed completed-step context. */
export type AfterStepGuardrails<TContext extends StepContext<any, any, any, any> = StepContext>
  = | readonly Guardrail<any, any>[]
    | ((ctx: TContext) => readonly Guardrail<any, any>[])

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
  beforeStep?: BeforeStepGuardrails<TMatrixContext>
  afterStep?: AfterStepGuardrails<TContext>
  run: StepRunFn<TOutput, TContext> | StepRunFactory<TContext> | AgentRunner<TOutput, TContext>
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
  configPath?: string
  signal?: AbortSignal
}

export interface HarnessRunResult {
  runId: string
  status: 'passed' | 'failed'
  steps: Record<string, StepResult<unknown>>
  failedStepId?: string
  error?: unknown
}
