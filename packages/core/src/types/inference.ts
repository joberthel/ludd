import type { z } from 'zod'
import type { AgentRunner, AgentStepOutput } from './agent.js'
import type { ArtifactValidationRule } from './artifact.js'
import type { StepContext, StepResult } from './context.js'
import type { StepConfig } from './harness.js'

export type {
  ArtifactMatrixStepDef,
  ItemsMatrixStepDef,
  PlainStepDef,
  StepTupleEntry,
  TypedStep,
} from './step-definition.js'

export type InferArrayItem<T>
  = T extends z.ZodType<readonly (infer TItem)[]>
    ? TItem
    : never

export type StepArtifactItemMap<S> = S extends { artifacts?: infer TArtifacts }
  ? string extends keyof NonNullable<TArtifacts>
    ? Record<never, never>
    : [NonNullable<TArtifacts>] extends [Record<string, ArtifactValidationRule<any>>]
        ? {
            [K in keyof NonNullable<TArtifacts> as K extends string
              ? InferArrayItem<NonNullable<TArtifacts>[K] extends { schema?: infer SSchema } ? SSchema : never> extends never
                ? never
                : K
              : never]: InferArrayItem<NonNullable<TArtifacts>[K] extends { schema?: infer SSchema } ? SSchema : never>
          }
        : Record<never, never>
  : Record<never, never>

export type AccumulateArtifactItemMap<TPriorSteps extends readonly unknown[]>
  = TPriorSteps extends readonly [infer Head, ...infer Tail]
    ? Tail extends readonly []
      ? StepArtifactItemMap<Head>
      : StepArtifactItemMap<Head> & AccumulateArtifactItemMap<Tail>
    : Record<never, never>

export type InferSingleStepOutput<TStep>
  = 'outputSchema' extends keyof TStep
    ? NonNullable<TStep['outputSchema']> extends z.ZodType<infer TSchemaOutput>
      ? TStep extends { run?: AgentRunner<any, any> | { readonly __kind: 'agent' } }
        ? AgentStepOutput<TSchemaOutput>
        : TSchemaOutput
      : TStep extends { run?: AgentRunner<infer TRunnerOutput, any> }
        ? AgentStepOutput<TRunnerOutput>
        : unknown
    : TStep extends { run?: { executeTurn: (...args: any[]) => infer Ret } }
      ? Awaited<Ret> extends { output: infer TRunnerOutput }
        ? AgentStepOutput<TRunnerOutput>
        : AgentStepOutput<unknown>
      : TStep extends { run?: AgentRunner<infer TRunnerOutput, any> }
        ? AgentStepOutput<TRunnerOutput>
        : TStep extends { run?: { readonly __kind: 'agent' } }
          ? AgentStepOutput<unknown>
          : TStep extends { run?: (...args: any[]) => infer TReturn }
            ? Awaited<TReturn>
            : TStep extends StepConfig<string, infer TOutput>
              ? TOutput
              : unknown

export type InferStepOutput<TStep>
  = TStep extends { matrix?: { items: any } | { itemsFromArtifact: any } }
    ? [TStep['matrix']] extends [undefined]
        ? InferSingleStepOutput<TStep>
        : [TStep['matrix']] extends [never]
            ? InferSingleStepOutput<TStep>
            : InferSingleStepOutput<TStep>[]
    : TStep extends { matrix: any }
      ? InferSingleStepOutput<TStep>[]
      : InferSingleStepOutput<TStep>

export type AccumulatePriorSteps<TPriorSteps extends readonly unknown[]> = {
  [S in TPriorSteps[number] as S extends { id: infer Id extends string } ? Id : never]: StepResult<
    InferStepOutput<S>
  >
}

export type InferMatrixItem<TStep, TArtifactItemMap = Record<string, unknown>>
  = TStep extends { matrix?: { items: infer TItems } }
    ? TItems extends (...args: any[]) => infer TReturn
      ? Awaited<TReturn> extends readonly (infer TItem)[]
        ? TItem
        : unknown
      : TItems extends readonly (infer TItem)[]
        ? TItem
        : unknown
    : TStep extends { matrix?: { itemsFromArtifact: infer K extends string } }
      ? K extends keyof TArtifactItemMap
        ? TArtifactItemMap[K]
        : unknown
      : unknown

export type StepHasMatrix<TStep>
  = TStep extends { matrix?: { items: any } | { itemsFromArtifact: any } }
    ? [TStep['matrix']] extends [undefined]
        ? false
        : [TStep['matrix']] extends [never]
            ? false
            : true
    : false

export type PriorStepContext<TPriorSteps extends readonly unknown[]> = StepContext<
  unknown,
  AccumulatePriorSteps<TPriorSteps>,
  unknown,
  false
>

export type DerivedStepContext<
  TPriorSteps extends readonly unknown[],
  TStep = unknown,
> = StepContext<
  unknown,
  AccumulatePriorSteps<TPriorSteps>,
  InferMatrixItem<TStep, AccumulateArtifactItemMap<TPriorSteps>>,
  StepHasMatrix<TStep>
>
