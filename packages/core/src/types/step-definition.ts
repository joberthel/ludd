import type { z } from 'zod'
import type { AgentRunner } from './agent.js'
import type {
  DynamicProperty,
  EnvironmentAdapter,
  ProvisionedEnvironment,
  StepContext,
  StepContextWithBeforeStep,
  StepContextWithInteractive,
} from './context.js'
import type { Guardrail, OnMaxRetriesExceededAction } from './guardrail.js'
import type { AfterStepGuardrails, BeforeStepGuardrails, BeforeStepResults, StepRunFactory, StepRunFn } from './harness.js'
import type {
  AccumulateArtifactItemMap,
  AccumulatePriorSteps,
  InferMatrixItem,
  InferSingleStepOutput,
  PriorStepContext,
} from './inference.js'
import type { InteractiveAnswers, StepInteractiveConfig } from './interactive.js'

type StepExecutionContext<TContext, TBeforeStep, TInteractive> = StepContextWithInteractive<
  StepContextWithBeforeStep<TContext, BeforeStepResults<TBeforeStep>>,
  InteractiveAnswers<TInteractive>
>

export interface PlainStepDef<
  TPriorSteps extends readonly unknown[],
  TId extends string = string,
  TOutput = any,
  TArtifacts = any,
  TBeforeStep = readonly Guardrail<any, any>[],
  TInteractive = boolean,
> {
  id: TId
  name?: string
  dangerMode?: boolean
  if?: (ctx: PriorStepContext<TPriorSteps>) => boolean | Promise<boolean>
  environment?: DynamicProperty<ProvisionedEnvironment | EnvironmentAdapter, StepContext<unknown, AccumulatePriorSteps<TPriorSteps>, unknown, false>>
  cwd?: DynamicProperty<string, StepContext<unknown, AccumulatePriorSteps<TPriorSteps>, unknown, false>>
  env?: DynamicProperty<Record<string, string>, StepContext<unknown, AccumulatePriorSteps<TPriorSteps>, unknown, false>>
  matrix?: never
  outputSchema?: z.ZodType<TOutput>
  maxTotalTurns?: number
  onMaxRetriesExceeded?: OnMaxRetriesExceededAction
  artifacts?: TArtifacts
  beforeStep?: TBeforeStep & BeforeStepGuardrails<StepContext<unknown, AccumulatePriorSteps<TPriorSteps>, unknown, false>>
  interactive?: TInteractive & StepInteractiveConfig<
    StepContextWithBeforeStep<
      StepContext<unknown, AccumulatePriorSteps<TPriorSteps>, unknown, false>,
      BeforeStepResults<TBeforeStep>
    >
  >
  afterStep?: AfterStepGuardrails<
    StepExecutionContext<
      StepContext<
        InferSingleStepOutput<{ outputSchema?: z.ZodType<TOutput>, run: PlainStepDef<TPriorSteps, TId, TOutput, TArtifacts>['run'] }>,
        AccumulatePriorSteps<TPriorSteps>,
        unknown,
        false
      >,
      TBeforeStep,
      TInteractive
    >
  >
  run:
    | StepRunFn<any, StepExecutionContext<StepContext<unknown, AccumulatePriorSteps<TPriorSteps>, unknown, false>, TBeforeStep, TInteractive>>
    | StepRunFactory<StepExecutionContext<StepContext<unknown, AccumulatePriorSteps<TPriorSteps>, unknown, false>, TBeforeStep, TInteractive>>
    | AgentRunner<any, StepExecutionContext<StepContext<unknown, AccumulatePriorSteps<TPriorSteps>, unknown, false>, TBeforeStep, TInteractive>>
}

export interface ItemsMatrixStepDef<
  TPriorSteps extends readonly unknown[],
  TId extends string = string,
  TOutput = any,
  TArtifacts = any,
  TItem = any,
  TBeforeStep = readonly Guardrail<any, any>[],
  TInteractive = boolean,
> {
  id: TId
  name?: string
  dangerMode?: boolean
  if?: (ctx: PriorStepContext<TPriorSteps>) => boolean | Promise<boolean>
  environment?: DynamicProperty<ProvisionedEnvironment | EnvironmentAdapter, StepContext<unknown, AccumulatePriorSteps<TPriorSteps>, TItem, true>>
  cwd?: DynamicProperty<string, StepContext<unknown, AccumulatePriorSteps<TPriorSteps>, TItem, true>>
  env?: DynamicProperty<Record<string, string>, StepContext<unknown, AccumulatePriorSteps<TPriorSteps>, TItem, true>>
  matrix: {
    items: DynamicProperty<readonly TItem[], PriorStepContext<TPriorSteps>>
    itemsFromArtifact?: never
  }
  outputSchema?: z.ZodType<TOutput>
  maxTotalTurns?: number
  onMaxRetriesExceeded?: OnMaxRetriesExceededAction
  artifacts?: TArtifacts
  beforeStep?: TBeforeStep & BeforeStepGuardrails<StepContext<unknown, AccumulatePriorSteps<TPriorSteps>, TItem, true>>
  interactive?: TInteractive & StepInteractiveConfig<
    StepContextWithBeforeStep<
      StepContext<unknown, AccumulatePriorSteps<TPriorSteps>, TItem, true>,
      BeforeStepResults<TBeforeStep>
    >
  >
  afterStep?: AfterStepGuardrails<
    StepExecutionContext<
      StepContext<
        InferSingleStepOutput<{ outputSchema?: z.ZodType<TOutput>, run: ItemsMatrixStepDef<TPriorSteps, TId, TOutput, TArtifacts, TItem>['run'] }>,
        AccumulatePriorSteps<TPriorSteps>,
        TItem,
        true
      >,
      TBeforeStep,
      TInteractive
    >
  >
  run:
    | StepRunFn<any, StepExecutionContext<StepContext<unknown, AccumulatePriorSteps<TPriorSteps>, TItem, true>, TBeforeStep, TInteractive>>
    | StepRunFactory<StepExecutionContext<StepContext<unknown, AccumulatePriorSteps<TPriorSteps>, TItem, true>, TBeforeStep, TInteractive>>
    | AgentRunner<any, StepExecutionContext<StepContext<unknown, AccumulatePriorSteps<TPriorSteps>, TItem, true>, TBeforeStep, TInteractive>>
}

export interface ArtifactMatrixStepDef<
  TPriorSteps extends readonly unknown[],
  TId extends string = string,
  TOutput = any,
  TArtifacts = any,
  TKey extends string = string,
  TBeforeStep = readonly Guardrail<any, any>[],
  TInteractive = boolean,
> {
  id: TId
  name?: string
  dangerMode?: boolean
  if?: (ctx: PriorStepContext<TPriorSteps>) => boolean | Promise<boolean>
  environment?: DynamicProperty<
    ProvisionedEnvironment | EnvironmentAdapter,
    StepContext<
      unknown,
      AccumulatePriorSteps<TPriorSteps>,
      InferMatrixItem<{ matrix: { itemsFromArtifact: TKey } }, AccumulateArtifactItemMap<TPriorSteps>>,
      true
    >
  >
  cwd?: DynamicProperty<
    string,
    StepContext<
      unknown,
      AccumulatePriorSteps<TPriorSteps>,
      InferMatrixItem<{ matrix: { itemsFromArtifact: TKey } }, AccumulateArtifactItemMap<TPriorSteps>>,
      true
    >
  >
  env?: DynamicProperty<
    Record<string, string>,
    StepContext<
      unknown,
      AccumulatePriorSteps<TPriorSteps>,
      InferMatrixItem<{ matrix: { itemsFromArtifact: TKey } }, AccumulateArtifactItemMap<TPriorSteps>>,
      true
    >
  >
  matrix: {
    itemsFromArtifact: TKey
    items?: never
  }
  outputSchema?: z.ZodType<TOutput>
  maxTotalTurns?: number
  onMaxRetriesExceeded?: OnMaxRetriesExceededAction
  artifacts?: TArtifacts
  beforeStep?: TBeforeStep & BeforeStepGuardrails<
    StepContext<
      unknown,
      AccumulatePriorSteps<TPriorSteps>,
      InferMatrixItem<{ matrix: { itemsFromArtifact: TKey } }, AccumulateArtifactItemMap<TPriorSteps>>,
      true
    >
  >
  interactive?: TInteractive & StepInteractiveConfig<
    StepContextWithBeforeStep<
      StepContext<
        unknown,
        AccumulatePriorSteps<TPriorSteps>,
        InferMatrixItem<{ matrix: { itemsFromArtifact: TKey } }, AccumulateArtifactItemMap<TPriorSteps>>,
        true
      >,
      BeforeStepResults<TBeforeStep>
    >
  >
  afterStep?: AfterStepGuardrails<
    StepExecutionContext<
      StepContext<
        InferSingleStepOutput<{ outputSchema?: z.ZodType<TOutput>, run: ArtifactMatrixStepDef<TPriorSteps, TId, TOutput, TArtifacts, TKey>['run'] }>,
        AccumulatePriorSteps<TPriorSteps>,
        InferMatrixItem<{ matrix: { itemsFromArtifact: TKey } }, AccumulateArtifactItemMap<TPriorSteps>>,
        true
      >,
      TBeforeStep,
      TInteractive
    >
  >
  run:
    | StepRunFn<
      any,
      StepExecutionContext<
        StepContext<
          unknown,
          AccumulatePriorSteps<TPriorSteps>,
          InferMatrixItem<{ matrix: { itemsFromArtifact: TKey } }, AccumulateArtifactItemMap<TPriorSteps>>,
          true
        >,
        TBeforeStep,
        TInteractive
      >
    >
    | StepRunFactory<
      StepExecutionContext<
        StepContext<
          unknown,
          AccumulatePriorSteps<TPriorSteps>,
          InferMatrixItem<{ matrix: { itemsFromArtifact: TKey } }, AccumulateArtifactItemMap<TPriorSteps>>,
          true
        >,
        TBeforeStep,
        TInteractive
      >
    >
    | AgentRunner<
      any,
      StepExecutionContext<
        StepContext<
          unknown,
          AccumulatePriorSteps<TPriorSteps>,
          InferMatrixItem<{ matrix: { itemsFromArtifact: TKey } }, AccumulateArtifactItemMap<TPriorSteps>>,
          true
        >,
        TBeforeStep,
        TInteractive
      >
    >
}

export type TypedStep<
  TPriorSteps extends readonly unknown[],
  TId extends string = string,
  TOutput = any,
  TArtifacts = any,
  TItem = any,
  TKey extends string = string,
>
  = | PlainStepDef<TPriorSteps, TId, TOutput, TArtifacts>
    | ItemsMatrixStepDef<TPriorSteps, TId, TOutput, TArtifacts, TItem>
    | ArtifactMatrixStepDef<TPriorSteps, TId, TOutput, TArtifacts, TKey>

export interface StepTupleEntry<
  TId extends string,
  TOutput,
  TArtifacts,
  TItem = never,
  TKey extends string = never,
> {
  id: TId
  environment?: DynamicProperty<ProvisionedEnvironment | EnvironmentAdapter, any>
  cwd?: DynamicProperty<string, any>
  env?: DynamicProperty<Record<string, string>, any>
  onMaxRetriesExceeded?: OnMaxRetriesExceededAction
  artifacts?: TArtifacts
  outputSchema?: z.ZodType<TOutput>
  beforeStep?: readonly Guardrail<any, any>[]
  afterStep?: readonly Guardrail<any, any>[]
  matrix?: [TKey] extends [never]
    ? [TItem] extends [never]
        ? never
        : { items: readonly TItem[] }
    : { itemsFromArtifact: TKey }
  run?: { readonly __kind: 'agent' } | ((...args: any[]) => any)
}
