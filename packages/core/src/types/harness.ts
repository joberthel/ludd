import type { z } from 'zod'
import type {
  AgentAccessMode,
  AgentMcpConnection,
  AgentRunner,
  AgentStepOutput,
  AgentTurnInput,
  AgentTurnResult,
} from './agent.js'
import type { ArtifactValidationRule } from './artifact.js'
import type { DynamicProperty, StepContext, StepResult } from './context.js'
import type { Guardrail, OnMaxRetriesExceededAction } from './guardrail.js'
import type { StepInteractiveConfig } from './interactive.js'

export { isGuardrail } from './guardrail.js'
export type { OnMaxRetriesExceededAction } from './guardrail.js'

export type {
  AgentAccessMode,
  AgentMcpConnection,
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
    | ((ctx: TContext) => readonly Guardrail<any, any>[] | Promise<readonly Guardrail<any, any>[]>)

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

export interface RunLifecycleContext {
  runId: string
  workspaceRoot: string
  signal: AbortSignal
}

export interface SetupResult {
  cwd?: string
  env?: Record<string, string>
}

export interface HarnessExecutionConfig {
  /** Working directory for steps, guardrails, and agents. Defaults to process.cwd(). */
  cwd?: DynamicProperty<string, RunLifecycleContext>
  /** Additional environment variables passed to commands and agents. */
  env?: DynamicProperty<Record<string, string>, RunLifecycleContext>
  /** Optional one-time run setup hook (e.g., create a git worktree). */
  setup?: (ctx: RunLifecycleContext) => void | SetupResult | Promise<void | SetupResult>
  /** Optional run cleanup hook guaranteed to execute on completion, failure, or abort. */
  teardown?: (ctx: RunLifecycleContext) => void | Promise<void>
}

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
  if?: (ctx: TMatrixContext) => boolean | Promise<boolean>
  cwd?: DynamicProperty<string, TContext>
  env?: DynamicProperty<Record<string, string>, TContext>
  matrix?: MatrixConfig<TMatrixItem, TMatrixContext, TArtifactKey>
  outputSchema?: z.ZodType<TOutput>
  onMaxRetriesExceeded?: OnMaxRetriesExceededAction
  artifacts?: TArtifacts
  beforeStep?: BeforeStepGuardrails<TMatrixContext>
  interactive?: StepInteractiveConfig<TMatrixContext>
  afterStep?: AfterStepGuardrails<TContext>
  run: StepRunFn<TOutput, TContext> | StepRunFactory<TContext> | AgentRunner<TOutput, TContext>
}

export interface HarnessConfig<
  TSteps extends readonly StepConfig<any, any, any, any, any, any, any>[] = readonly StepConfig[],
  TName extends string = string,
> extends HarnessExecutionConfig {
  name: TName
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
