import type { z } from 'zod'
import type { AgentRunner } from './agent.js'
import type { DynamicProperty, ProvisionedEnvironment, StepContext } from './context.js'
import type { Guardrail, OnMaxRetriesExceededAction } from './guardrail.js'
import type { AfterStepGuardrails, BeforeStepGuardrails, StepRunFactory, StepRunFn } from './harness.js'
import type {
  AccumulateArtifactItemMap,
  AccumulatePriorSteps,
  InferMatrixItem,
  InferSingleStepOutput,
  PriorStepContext,
} from './inference.js'

export interface PlainStepDef<
  TPriorSteps extends readonly unknown[],
  TId extends string = string,
  TOutput = any,
  TArtifacts = any,
> {
  id: TId
  name?: string
  dangerMode?: boolean
  if?: (ctx: PriorStepContext<TPriorSteps>) => boolean | Promise<boolean>
  environment?: DynamicProperty<ProvisionedEnvironment, StepContext<unknown, AccumulatePriorSteps<TPriorSteps>, unknown, false>>
  matrix?: never
  outputSchema?: z.ZodType<TOutput>
  maxTotalTurns?: number
  onMaxRetriesExceeded?: OnMaxRetriesExceededAction
  artifacts?: TArtifacts
  beforeStep?: BeforeStepGuardrails<StepContext<unknown, AccumulatePriorSteps<TPriorSteps>, unknown, false>>
  afterStep?: AfterStepGuardrails<
    StepContext<
      InferSingleStepOutput<{ outputSchema?: z.ZodType<TOutput>, run: PlainStepDef<TPriorSteps, TId, TOutput, TArtifacts>['run'] }>,
      AccumulatePriorSteps<TPriorSteps>,
      unknown,
      false
    >
  >
  run:
    | StepRunFn<any, StepContext<unknown, AccumulatePriorSteps<TPriorSteps>, unknown, false>>
    | StepRunFactory<StepContext<unknown, AccumulatePriorSteps<TPriorSteps>, unknown, false>>
    | AgentRunner<any, StepContext<unknown, AccumulatePriorSteps<TPriorSteps>, unknown, false>>
}

export interface ItemsMatrixStepDef<
  TPriorSteps extends readonly unknown[],
  TId extends string = string,
  TOutput = any,
  TArtifacts = any,
  TItem = any,
> {
  id: TId
  name?: string
  dangerMode?: boolean
  if?: (ctx: PriorStepContext<TPriorSteps>) => boolean | Promise<boolean>
  environment?: DynamicProperty<ProvisionedEnvironment, StepContext<unknown, AccumulatePriorSteps<TPriorSteps>, TItem, true>>
  matrix: {
    items: DynamicProperty<readonly TItem[], PriorStepContext<TPriorSteps>>
    itemsFromArtifact?: never
    concurrency?: number
  }
  outputSchema?: z.ZodType<TOutput>
  maxTotalTurns?: number
  onMaxRetriesExceeded?: OnMaxRetriesExceededAction
  artifacts?: TArtifacts
  beforeStep?: BeforeStepGuardrails<StepContext<unknown, AccumulatePriorSteps<TPriorSteps>, TItem, true>>
  afterStep?: AfterStepGuardrails<
    StepContext<
      InferSingleStepOutput<{ outputSchema?: z.ZodType<TOutput>, run: ItemsMatrixStepDef<TPriorSteps, TId, TOutput, TArtifacts, TItem>['run'] }>,
      AccumulatePriorSteps<TPriorSteps>,
      TItem,
      true
    >
  >
  run:
    | StepRunFn<any, StepContext<unknown, AccumulatePriorSteps<TPriorSteps>, TItem, true>>
    | StepRunFactory<StepContext<unknown, AccumulatePriorSteps<TPriorSteps>, TItem, true>>
    | AgentRunner<any, StepContext<unknown, AccumulatePriorSteps<TPriorSteps>, TItem, true>>
}

export interface ArtifactMatrixStepDef<
  TPriorSteps extends readonly unknown[],
  TId extends string = string,
  TOutput = any,
  TArtifacts = any,
  TKey extends string = string,
> {
  id: TId
  name?: string
  dangerMode?: boolean
  if?: (ctx: PriorStepContext<TPriorSteps>) => boolean | Promise<boolean>
  environment?: DynamicProperty<
    ProvisionedEnvironment,
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
    concurrency?: number
  }
  outputSchema?: z.ZodType<TOutput>
  maxTotalTurns?: number
  onMaxRetriesExceeded?: OnMaxRetriesExceededAction
  artifacts?: TArtifacts
  beforeStep?: BeforeStepGuardrails<
    StepContext<
      unknown,
      AccumulatePriorSteps<TPriorSteps>,
      InferMatrixItem<{ matrix: { itemsFromArtifact: TKey } }, AccumulateArtifactItemMap<TPriorSteps>>,
      true
    >
  >[]
  afterStep?: AfterStepGuardrails<
    StepContext<
      InferSingleStepOutput<{ outputSchema?: z.ZodType<TOutput>, run: ArtifactMatrixStepDef<TPriorSteps, TId, TOutput, TArtifacts, TKey>['run'] }>,
      AccumulatePriorSteps<TPriorSteps>,
      InferMatrixItem<{ matrix: { itemsFromArtifact: TKey } }, AccumulateArtifactItemMap<TPriorSteps>>,
      true
    >
  >
  run:
    | StepRunFn<
      any,
      StepContext<
        unknown,
        AccumulatePriorSteps<TPriorSteps>,
        InferMatrixItem<{ matrix: { itemsFromArtifact: TKey } }, AccumulateArtifactItemMap<TPriorSteps>>,
        true
      >
    >
    | StepRunFactory<
      StepContext<
        unknown,
        AccumulatePriorSteps<TPriorSteps>,
        InferMatrixItem<{ matrix: { itemsFromArtifact: TKey } }, AccumulateArtifactItemMap<TPriorSteps>>,
        true
      >
    >
    | AgentRunner<
      any,
      StepContext<
        unknown,
        AccumulatePriorSteps<TPriorSteps>,
        InferMatrixItem<{ matrix: { itemsFromArtifact: TKey } }, AccumulateArtifactItemMap<TPriorSteps>>,
        true
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
  environment?: DynamicProperty<ProvisionedEnvironment, any>
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
