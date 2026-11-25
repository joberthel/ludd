import type { z } from 'zod'
import type { DynamicProperty } from './types/context.js'
import type { CleanupPolicy, HarnessConfig, HarnessExecutionConfig } from './types/harness.js'
import type {
  ArtifactMatrixStepDef,
  ItemsMatrixStepDef,
  PlainStepDef,
  PriorStepContext,
} from './types/inference.js'
import {
  validateCleanupPolicy,
  validateCwdConfig,
  validateEnvConfig,
  validateLifecycleHook,
  validateStep,
} from './define-harness-validators.js'
import { HarnessConfigError } from './errors/harness-config-error.js'

export { isAgentRunner } from './types/harness.js'

export interface CreateHarnessOptions extends HarnessExecutionConfig {
  cleanupPolicy?: CleanupPolicy
}

type DefinedHarnessConfig<TName extends string, TSteps> = HarnessExecutionConfig & {
  name: TName
  cleanupPolicy?: CleanupPolicy
  steps: TSteps
}

interface Step0Constraint {
  id: string
  artifacts?: any
  outputSchema?: any
  run?: any
  cwd?: DynamicProperty<string, PriorStepContext<[]>>
  env?: DynamicProperty<Record<string, string>, PriorStepContext<[]>>
}

export function validateHarnessConfig(config: unknown): HarnessConfig {
  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    throw new HarnessConfigError('Harness config must be a non-null object.')
  }

  const rawConfig = config as Record<string, unknown>
  if (typeof rawConfig.name !== 'string' || rawConfig.name.trim() === '') {
    throw new HarnessConfigError(
      'Harness config "name" must be a non-empty trimmed string.',
    )
  }

  validateCleanupPolicy(rawConfig.cleanupPolicy)
  validateCwdConfig(rawConfig.cwd, 'Harness config')
  validateEnvConfig(rawConfig.env, 'Harness config')
  validateLifecycleHook(rawConfig.setup, 'setup')
  validateLifecycleHook(rawConfig.teardown, 'teardown')

  if (!Array.isArray(rawConfig.steps) || rawConfig.steps.length === 0) {
    throw new HarnessConfigError(
      'Harness config "steps" must be a non-empty array.',
    )
  }

  const seenIds = new Set<string>()
  for (let i = 0; i < rawConfig.steps.length; i++) {
    validateStep(rawConfig.steps[i], i, seenIds)
  }

  return config as HarnessConfig
}

// 1. 4-step workflow: Plain -> Plain -> ArtifactMatrix -> Plain (TDD Section 9.2)
export function defineHarness<
  S0Id extends string = string,
  S0Out = any,
  S0Art = any,
  S1Id extends string = string,
  S1Out = any,
  S1Art = any,
  S2Id extends string = string,
  S2Out = any,
  S2Art = any,
  const S2Key extends string = string,
  S3Id extends string = string,
  S3Out = any,
  S3Art = any,
  TName extends string = string,
>(config: DefinedHarnessConfig<
  TName,
  readonly [
    PlainStepDef<[], S0Id, S0Out, S0Art>,
    PlainStepDef<
      [{ id: S0Id, outputSchema?: z.ZodType<S0Out>, artifacts?: S0Art, run?: { readonly __kind: 'agent' } }],
      S1Id,
      S1Out,
      S1Art
    >,
    ArtifactMatrixStepDef<
      [
        { id: S0Id, outputSchema?: z.ZodType<S0Out>, artifacts?: S0Art, run?: { readonly __kind: 'agent' } },
        { id: S1Id, outputSchema?: z.ZodType<S1Out>, artifacts?: S1Art, run?: (...args: any[]) => any },
      ],
      S2Id,
      S2Out,
      S2Art,
      S2Key
    >,
    PlainStepDef<
      [
        { id: S0Id, outputSchema?: z.ZodType<S0Out>, artifacts?: S0Art, run?: { readonly __kind: 'agent' } },
        { id: S1Id, outputSchema?: z.ZodType<S1Out>, artifacts?: S1Art, run?: (...args: any[]) => any },
        { id: S2Id, matrix: { itemsFromArtifact: S2Key }, outputSchema?: z.ZodType<S2Out>, run?: { readonly __kind: 'agent' } },
      ],
      S3Id,
      S3Out,
      S3Art
    >,
  ]
>): DefinedHarnessConfig<
  TName,
  readonly [
    PlainStepDef<[], S0Id, S0Out, S0Art>,
    PlainStepDef<
      [{ id: S0Id, outputSchema?: z.ZodType<S0Out>, artifacts?: S0Art, run?: { readonly __kind: 'agent' } }],
      S1Id,
      S1Out,
      S1Art
    >,
    ArtifactMatrixStepDef<
      [
        { id: S0Id, outputSchema?: z.ZodType<S0Out>, artifacts?: S0Art, run?: { readonly __kind: 'agent' } },
        { id: S1Id, outputSchema?: z.ZodType<S1Out>, artifacts?: S1Art, run?: (...args: any[]) => any },
      ],
      S2Id,
      S2Out,
      S2Art,
      S2Key
    >,
    PlainStepDef<
      [
        { id: S0Id, outputSchema?: z.ZodType<S0Out>, artifacts?: S0Art, run?: { readonly __kind: 'agent' } },
        { id: S1Id, outputSchema?: z.ZodType<S1Out>, artifacts?: S1Art, run?: (...args: any[]) => any },
        { id: S2Id, matrix: { itemsFromArtifact: S2Key }, outputSchema?: z.ZodType<S2Out>, run?: { readonly __kind: 'agent' } },
      ],
      S3Id,
      S3Out,
      S3Art
    >,
  ]
>

// 2. 3-step pipeline: Plain -> ArtifactMatrix -> Plain (AC 4.4.1 & AC 4.4.4)
export function defineHarness<
  const TStep0 extends Step0Constraint,
  S1Id extends string = string,
  S1Out = any,
  S1Art = any,
  const S1Key extends string = string,
  S2Id extends string = string,
  S2Out = any,
  S2Art = any,
  TName extends string = string,
>(config: DefinedHarnessConfig<
  TName,
  readonly [
    TStep0,
    ArtifactMatrixStepDef<[TStep0], S1Id, S1Out, S1Art, S1Key>,
    PlainStepDef<
      [
        TStep0,
        { id: S1Id, matrix: { itemsFromArtifact: S1Key }, outputSchema?: z.ZodType<S1Out>, run?: { readonly __kind: 'agent' } },
      ],
      S2Id,
      S2Out,
      S2Art
    >,
  ]
>): DefinedHarnessConfig<
  TName,
  readonly [
    TStep0,
    ArtifactMatrixStepDef<[TStep0], S1Id, S1Out, S1Art, S1Key>,
    PlainStepDef<
      [
        TStep0,
        { id: S1Id, matrix: { itemsFromArtifact: S1Key }, outputSchema?: z.ZodType<S1Out>, run?: { readonly __kind: 'agent' } },
      ],
      S2Id,
      S2Out,
      S2Art
    >,
  ]
>

// Two plain steps, with the second step's beforeStep result inferred in its run context.
export function defineHarness<
  const TStep0 extends Step0Constraint,
  S1Id extends string = string,
  S1Out = any,
  S1Art = any,
  const S1BeforeStep extends import('./types/harness.js').BeforeStepGuardrailSet
    | ((ctx: import('./types/inference.js').PriorStepContext<[TStep0]>) => import('./types/harness.js').BeforeStepGuardrailSet | Promise<import('./types/harness.js').BeforeStepGuardrailSet>) = readonly import('./types/guardrail.js').Guardrail[],
  TName extends string = string,
>(config: DefinedHarnessConfig<
  TName,
  readonly [
    TStep0,
    PlainStepDef<[TStep0], S1Id, S1Out, S1Art, S1BeforeStep> & { beforeStep: S1BeforeStep },
  ]
>): DefinedHarnessConfig<
  TName,
  readonly [
    TStep0,
    PlainStepDef<[TStep0], S1Id, S1Out, S1Art, S1BeforeStep> & { beforeStep: S1BeforeStep },
  ]
>

// 3. 2-step pipeline: Plain -> ArtifactMatrix
export function defineHarness<
  const TStep0 extends Step0Constraint,
  S1Id extends string = string,
  S1Out = any,
  S1Art = any,
  const S1Key extends string = string,
  TName extends string = string,
>(config: DefinedHarnessConfig<
  TName,
  readonly [
    TStep0,
    ArtifactMatrixStepDef<[TStep0], S1Id, S1Out, S1Art, S1Key>,
  ]
>): DefinedHarnessConfig<
  TName,
  readonly [
    TStep0,
    ArtifactMatrixStepDef<[TStep0], S1Id, S1Out, S1Art, S1Key>,
  ]
>

// 4. 2-step pipeline: Plain -> ItemsMatrix
export function defineHarness<
  const TStep0 extends Step0Constraint,
  S1Id extends string = string,
  S1Out = any,
  S1Art = any,
  S1Item = any,
  TName extends string = string,
>(config: DefinedHarnessConfig<
  TName,
  readonly [
    TStep0,
    ItemsMatrixStepDef<[TStep0], S1Id, S1Out, S1Art, S1Item>,
  ]
>): DefinedHarnessConfig<
  TName,
  readonly [
    TStep0,
    ItemsMatrixStepDef<[TStep0], S1Id, S1Out, S1Art, S1Item>,
  ]
>

// 5. 1-step pipeline: ItemsMatrix (AC 4.4.2 static matrix)
export function defineHarness<
  S0Id extends string = string,
  S0Out = any,
  S0Art = any,
  S0Item = any,
  TName extends string = string,
>(config: DefinedHarnessConfig<
  TName,
  readonly [
    ItemsMatrixStepDef<[], S0Id, S0Out, S0Art, S0Item>,
  ]
>): DefinedHarnessConfig<
  TName,
  readonly [
    ItemsMatrixStepDef<[], S0Id, S0Out, S0Art, S0Item>,
  ]
>

// 6. 1-step pipeline: Plain step. Keep this overload before the broad fallback
// so the step's output schema contextually types its afterStep factory.
export function defineHarness<
  S0Id extends string = string,
  S0Out = any,
  S0Art = any,
  const S0BeforeStep extends import('./types/harness.js').BeforeStepGuardrailSet | ((ctx: import('./types/context.js').StepContext) => import('./types/harness.js').BeforeStepGuardrailSet | Promise<import('./types/harness.js').BeforeStepGuardrailSet>) = readonly import('./types/guardrail.js').Guardrail[],
  const S0Interactive extends import('./types/interactive.js').StepInteractiveConfig<any> = boolean,
  TName extends string = string,
>(config: DefinedHarnessConfig<
  TName,
  readonly [PlainStepDef<[], S0Id, S0Out, S0Art, S0BeforeStep, S0Interactive>]
>): DefinedHarnessConfig<
  TName,
  readonly [PlainStepDef<[], S0Id, S0Out, S0Art, S0BeforeStep, S0Interactive>]
>

// Fallback overload preserving step configuration
export function defineHarness<const TConfig extends HarnessConfig = HarnessConfig>(
  config: TConfig,
): TConfig

// Implementation
export function defineHarness(config: any): any {
  validateHarnessConfig(config)
  return config as HarnessConfig
}

export interface HarnessBuilder<
  TName extends string,
  TSteps extends readonly unknown[] = readonly [],
> {
  step: {
    <
      SId extends string,
      SOut = any,
      SArt = any,
      const SBeforeStep extends import('./types/harness.js').BeforeStepGuardrailSet
        | ((ctx: import('./types/inference.js').PriorStepContext<TSteps>) => import('./types/harness.js').BeforeStepGuardrailSet | Promise<import('./types/harness.js').BeforeStepGuardrailSet>) = readonly import('./types/guardrail.js').Guardrail[],
      const SInteractive extends import('./types/interactive.js').StepInteractiveConfig<any> = boolean,
    >(
      step: PlainStepDef<TSteps, SId, SOut, SArt, SBeforeStep, SInteractive>,
    ): HarnessBuilder<
      TName,
      readonly [...TSteps, PlainStepDef<TSteps, SId, SOut, SArt, SBeforeStep, SInteractive>]
    >
    <
      SId extends string,
      SOut = any,
      SArt = any,
      SItem = any,
      const SBeforeStep extends import('./types/harness.js').BeforeStepGuardrailSet
        | ((ctx: import('./types/context.js').StepContext<unknown, import('./types/inference.js').AccumulatePriorSteps<TSteps>, SItem, true>) => import('./types/harness.js').BeforeStepGuardrailSet | Promise<import('./types/harness.js').BeforeStepGuardrailSet>) = readonly import('./types/guardrail.js').Guardrail[],
    >(
      step: ItemsMatrixStepDef<TSteps, SId, SOut, SArt, SItem, SBeforeStep>,
    ): HarnessBuilder<
      TName,
      readonly [...TSteps, ItemsMatrixStepDef<TSteps, SId, SOut, SArt, SItem, SBeforeStep>]
    >
    <
      SId extends string,
      SOut = any,
      SArt = any,
      const SKey extends string = string,
      const SBeforeStep extends import('./types/harness.js').BeforeStepGuardrailSet
        | ((ctx: import('./types/context.js').StepContext<unknown, import('./types/inference.js').AccumulatePriorSteps<TSteps>, import('./types/inference.js').InferMatrixItem<{ matrix: { itemsFromArtifact: SKey } }, import('./types/inference.js').AccumulateArtifactItemMap<TSteps>>, true>) => import('./types/harness.js').BeforeStepGuardrailSet | Promise<import('./types/harness.js').BeforeStepGuardrailSet>) = readonly import('./types/guardrail.js').Guardrail[],
    >(
      step: ArtifactMatrixStepDef<TSteps, SId, SOut, SArt, SKey, SBeforeStep>,
    ): HarnessBuilder<
      TName,
      readonly [...TSteps, ArtifactMatrixStepDef<TSteps, SId, SOut, SArt, SKey, SBeforeStep>]
    >
  }
  build: () => DefinedHarnessConfig<TName, TSteps>
}

const HARNESS_OPTION_KEYS = [
  'cleanupPolicy',
  'cwd',
  'env',
  'setup',
  'teardown',
] as const

function pickHarnessOptions(options?: CreateHarnessOptions): Record<string, unknown> {
  if (options === undefined) {
    return {}
  }
  const picked: Record<string, unknown> = {}
  for (const key of HARNESS_OPTION_KEYS) {
    if (options[key] !== undefined) {
      picked[key] = options[key]
    }
  }
  return picked
}

export function createHarness<TName extends string>(
  name: TName,
  options?: CreateHarnessOptions,
): HarnessBuilder<TName> {
  const steps: unknown[] = []
  const pickedOptions = pickHarnessOptions(options)
  const builder = {
    step(step: unknown) {
      steps.push(step)
      return builder
    },
    build() {
      const config = {
        name,
        ...pickedOptions,
        steps: [...steps],
      }
      validateHarnessConfig(config)
      return config
    },
  }
  return builder as unknown as HarnessBuilder<TName>
}
