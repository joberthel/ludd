import type { HarnessConfig } from './types/harness.js'
import { HarnessConfigError } from './errors/harness-config-error.js'
import { isAgentRunner } from './types/harness.js'

function validateCleanupPolicy(policy: unknown): void {
  if (policy === undefined) {
    return
  }
  if (typeof policy !== 'object' || policy === null || Array.isArray(policy)) {
    throw new HarnessConfigError('Harness config "cleanupPolicy" must be an object.')
  }
  const raw = policy as Record<string, unknown>
  if (raw.onSuccess !== undefined && raw.onSuccess !== 'keep' && raw.onSuccess !== 'destroy') {
    throw new HarnessConfigError(
      'Harness config "cleanupPolicy.onSuccess" must be "keep" or "destroy".',
    )
  }
  if (raw.onFailure !== undefined && raw.onFailure !== 'keep' && raw.onFailure !== 'destroy') {
    throw new HarnessConfigError(
      'Harness config "cleanupPolicy.onFailure" must be "keep" or "destroy".',
    )
  }
}

function validateStep(step: unknown, index: number, seenIds: Set<string>): void {
  if (typeof step !== 'object' || step === null || Array.isArray(step)) {
    throw new HarnessConfigError(`Step at index ${index} must be a non-null object.`)
  }

  const rawStep = step as Record<string, unknown>
  if (typeof rawStep.id !== 'string' || rawStep.id.trim() === '') {
    throw new HarnessConfigError(
      `Step at index ${index} must have a non-empty trimmed string "id".`,
    )
  }

  const id = rawStep.id.trim()
  if (seenIds.has(id)) {
    throw new HarnessConfigError(`Duplicate step id "${id}" found in harness steps.`)
  }
  seenIds.add(id)

  if (rawStep.if !== undefined && typeof rawStep.if !== 'function') {
    throw new HarnessConfigError(
      `Step "${id}" "if" property must be a function when provided.`,
    )
  }

  if (
    rawStep.maxTotalTurns !== undefined
    && (typeof rawStep.maxTotalTurns !== 'number'
      || !Number.isInteger(rawStep.maxTotalTurns)
      || rawStep.maxTotalTurns < 1)
  ) {
    throw new HarnessConfigError(
      `Step "${id}" maxTotalTurns must be a positive integer, received ${String(rawStep.maxTotalTurns)}.`,
    )
  }

  if (typeof rawStep.run !== 'function' && !isAgentRunner(rawStep.run)) {
    throw new HarnessConfigError(
      `Step "${id}" must have a valid "run" property (function or AgentRunner).`,
    )
  }
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

export function defineHarness<const TConfig extends HarnessConfig>(
  config: TConfig,
): TConfig {
  validateHarnessConfig(config)
  return config
}
