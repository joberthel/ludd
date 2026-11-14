import type { z } from 'zod'
import type { CleanupPolicy, HarnessConfig } from './types/harness.js'
import type {
  ArtifactMatrixStepDef,
  ItemsMatrixStepDef,
  PlainStepDef,
} from './types/inference.js'
import { validateCleanupPolicy, validateStep } from './define-harness-validators.js'
import { HarnessConfigError } from './errors/harness-config-error.js'

export { isAgentRunner } from './types/harness.js'

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

// Two plain steps, with the second step's beforeStep result inferred in its run context.
export function defineHarness<
  const TStep0 extends { id: string, artifacts?: any, outputSchema?: any, run?: any },
  S1Id extends string = string,
  S1Out = any,
  S1Art = any,
  const S1BeforeStep extends import('./types/harness.js').BeforeStepGuardrailSet
    | ((ctx: import('./types/inference.js').PriorStepContext<[TStep0]>) => import('./types/harness.js').BeforeStepGuardrailSet | Promise<import('./types/harness.js').BeforeStepGuardrailSet>) = readonly import('./types/guardrail.js').Guardrail[],
  TName extends string = string,
>(config: {
  name: TName
  cleanupPolicy?: CleanupPolicy
  steps: readonly [
    TStep0,
    PlainStepDef<[TStep0], S1Id, S1Out, S1Art, S1BeforeStep> & { beforeStep: S1BeforeStep },
  ]
}): {
  name: TName
  cleanupPolicy?: CleanupPolicy
  steps: readonly [
    TStep0,
    PlainStepDef<[TStep0], S1Id, S1Out, S1Art, S1BeforeStep> & { beforeStep: S1BeforeStep },
  ]
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
>(config: {
  name: TName
  cleanupPolicy?: CleanupPolicy
  steps: readonly [
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
}): {
  name: TName
  cleanupPolicy?: CleanupPolicy
  steps: readonly [
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
}

// 2. 3-step pipeline: Plain -> ArtifactMatrix -> Plain (AC 4.4.1 & AC 4.4.4)
export function defineHarness<
  const TStep0 extends { id: string, artifacts?: any, outputSchema?: any, run?: any },
  S1Id extends string = string,
  S1Out = any,
  S1Art = any,
  const S1Key extends string = string,
  S2Id extends string = string,
  S2Out = any,
  S2Art = any,
  TName extends string = string,
>(config: {
  name: TName
  cleanupPolicy?: CleanupPolicy
  steps: readonly [
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
}): {
  name: TName
  cleanupPolicy?: CleanupPolicy
  steps: readonly [
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
}

// 3. 2-step pipeline: Plain -> ArtifactMatrix
export function defineHarness<
  const TStep0 extends { id: string, artifacts?: any, outputSchema?: any, run?: any },
  S1Id extends string = string,
  S1Out = any,
  S1Art = any,
  const S1Key extends string = string,
  TName extends string = string,
>(config: {
  name: TName
  cleanupPolicy?: CleanupPolicy
  steps: readonly [
    TStep0,
    ArtifactMatrixStepDef<[TStep0], S1Id, S1Out, S1Art, S1Key>,
  ]
}): {
  name: TName
  cleanupPolicy?: CleanupPolicy
  steps: readonly [
    TStep0,
    ArtifactMatrixStepDef<[TStep0], S1Id, S1Out, S1Art, S1Key>,
  ]
}

// 4. 2-step pipeline: Plain -> ItemsMatrix
export function defineHarness<
  const TStep0 extends { id: string, artifacts?: any, outputSchema?: any, run?: any },
  S1Id extends string = string,
  S1Out = any,
  S1Art = any,
  S1Item = any,
  TName extends string = string,
>(config: {
  name: TName
  cleanupPolicy?: CleanupPolicy
  steps: readonly [
    TStep0,
    ItemsMatrixStepDef<[TStep0], S1Id, S1Out, S1Art, S1Item>,
  ]
}): {
  name: TName
  cleanupPolicy?: CleanupPolicy
  steps: readonly [
    TStep0,
    ItemsMatrixStepDef<[TStep0], S1Id, S1Out, S1Art, S1Item>,
  ]
}

// 5. 1-step pipeline: ItemsMatrix (AC 4.4.2 static matrix)
export function defineHarness<
  S0Id extends string = string,
  S0Out = any,
  S0Art = any,
  S0Item = any,
  TName extends string = string,
>(config: {
  name: TName
  cleanupPolicy?: CleanupPolicy
  steps: readonly [
    ItemsMatrixStepDef<[], S0Id, S0Out, S0Art, S0Item>,
  ]
}): {
  name: TName
  cleanupPolicy?: CleanupPolicy
  steps: readonly [
    ItemsMatrixStepDef<[], S0Id, S0Out, S0Art, S0Item>,
  ]
}

// 6. 1-step pipeline: Plain step. Keep this overload before the broad fallback
// so the step's output schema contextually types its afterStep factory.
export function defineHarness<
  S0Id extends string = string,
  S0Out = any,
  S0Art = any,
  const S0BeforeStep extends import('./types/harness.js').BeforeStepGuardrailSet | ((ctx: import('./types/context.js').StepContext) => import('./types/harness.js').BeforeStepGuardrailSet | Promise<import('./types/harness.js').BeforeStepGuardrailSet>) = readonly import('./types/guardrail.js').Guardrail[],
  TName extends string = string,
>(config: {
  name: TName
  cleanupPolicy?: CleanupPolicy
  steps: readonly [PlainStepDef<[], S0Id, S0Out, S0Art, S0BeforeStep>]
}): {
  name: TName
  cleanupPolicy?: CleanupPolicy
  steps: readonly [PlainStepDef<[], S0Id, S0Out, S0Art, S0BeforeStep>]
}

// Fallback overload preserving step configuration
export function defineHarness<const TConfig extends HarnessConfig = HarnessConfig>(
  config: TConfig,
): TConfig

// Implementation
export function defineHarness(config: any): any {
  validateHarnessConfig(config)
  return config as HarnessConfig
}
