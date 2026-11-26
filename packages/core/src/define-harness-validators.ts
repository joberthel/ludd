import { HarnessConfigError } from './errors/harness-config-error.js'
import { isGuardrail } from './types/guardrail.js'
import { isAgentRunner } from './types/harness.js'

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }
  const proto = Object.getPrototypeOf(value) as unknown
  return proto === Object.prototype || proto === null
}

export function validateResolvedCwd(cwd: unknown, targetLabel: string): asserts cwd is string {
  if (typeof cwd !== 'string' || cwd.trim() === '') {
    throw new HarnessConfigError(
      `${targetLabel} "cwd" must be a non-empty trimmed string.`,
    )
  }
}

export function validateCwdConfig(cwd: unknown, targetLabel: string): void {
  if (cwd === undefined || typeof cwd === 'function') {
    return
  }
  if (typeof cwd === 'string' && cwd.trim() !== '') {
    return
  }
  throw new HarnessConfigError(
    `${targetLabel} "cwd" must be a non-empty trimmed string or a function when provided.`,
  )
}

export function validateEnvRecord(env: unknown, targetLabel: string): asserts env is Record<string, string> {
  if (!isPlainRecord(env)) {
    throw new HarnessConfigError(
      `${targetLabel} "env" must be a plain object of string values.`,
    )
  }
  for (const [key, value] of Object.entries(env)) {
    if (key.trim() === '' || key.includes('=') || key.includes('\0')) {
      throw new HarnessConfigError(
        `${targetLabel} "env" keys must be non-empty trimmed strings without "=" or null bytes.`,
      )
    }
    if (typeof value !== 'string' || value.includes('\0')) {
      throw new HarnessConfigError(
        `${targetLabel} "env" entry "${key}" must be a string without null bytes.`,
      )
    }
  }
}

export function validateEnvConfig(env: unknown, targetLabel: string): void {
  if (env === undefined || typeof env === 'function') {
    return
  }
  validateEnvRecord(env, targetLabel)
}

export function validateLifecycleHook(hook: unknown, hookName: 'setup' | 'teardown'): void {
  if (hook !== undefined && typeof hook !== 'function') {
    throw new HarnessConfigError(
      `Harness config "${hookName}" must be a function when provided.`,
    )
  }
}

function validateArtifactRule(id: string, key: string, rule: unknown): void {
  if (typeof rule !== 'object' || rule === null || Array.isArray(rule)) {
    throw new HarnessConfigError(
      `Step "${id}" artifact "${key}" validation rule must be a non-null object.`,
    )
  }
  const rawRule = rule as Record<string, unknown>
  if (rawRule.nonEmpty !== undefined && typeof rawRule.nonEmpty !== 'boolean') {
    throw new HarnessConfigError(
      `Step "${id}" artifact "${key}" "nonEmpty" must be a boolean when provided.`,
    )
  }
  if (
    rawRule.schema !== undefined
    && (typeof rawRule.schema !== 'object'
      || rawRule.schema === null
      || typeof (rawRule.schema as Record<string, unknown>).safeParseAsync !== 'function')
  ) {
    throw new HarnessConfigError(
      `Step "${id}" artifact "${key}" "schema" must be a valid Zod schema when provided.`,
    )
  }
  if (rawRule.validate !== undefined && typeof rawRule.validate !== 'function') {
    throw new HarnessConfigError(
      `Step "${id}" artifact "${key}" "validate" must be a function when provided.`,
    )
  }
}

export function validateStepArtifactsConfig(id: string, artifacts: unknown): void {
  if (artifacts === undefined) {
    return
  }
  if (typeof artifacts !== 'object' || artifacts === null || Array.isArray(artifacts)) {
    throw new HarnessConfigError(
      `Step "${id}" "artifacts" property must be a non-null object when provided.`,
    )
  }
  for (const [key, rule] of Object.entries(artifacts)) {
    if (key.trim() === '') {
      throw new HarnessConfigError(
        `Step "${id}" artifact key must be a non-empty trimmed string.`,
      )
    }
    validateArtifactRule(id, key, rule)
  }
}

export function validateStepMatrixConfig(id: string, matrix: unknown): void {
  if (matrix === undefined) {
    return
  }
  if (typeof matrix !== 'object' || matrix === null || Array.isArray(matrix)) {
    throw new HarnessConfigError(
      `Step "${id}" "matrix" property must be a non-null object when provided.`,
    )
  }
  const raw = matrix as Record<string, unknown>
  const hasItems = raw.items !== undefined
  const hasArtifact = raw.itemsFromArtifact !== undefined
  if ((!hasItems && !hasArtifact) || (hasItems && hasArtifact)) {
    throw new HarnessConfigError(
      `Step "${id}" matrix must specify either "items" or "itemsFromArtifact", not both or neither.`,
    )
  }
  if (hasItems) {
    const isValidItems = (Array.isArray(raw.items) && raw.items.length > 0) || typeof raw.items === 'function'
    if (!isValidItems) {
      throw new HarnessConfigError(
        `Step "${id}" matrix "items" must be a non-empty array or a function.`,
      )
    }
  }
  if (hasArtifact) {
    const isValidArtifact = typeof raw.itemsFromArtifact === 'string' && raw.itemsFromArtifact.trim() !== ''
    if (!isValidArtifact) {
      throw new HarnessConfigError(
        `Step "${id}" matrix "itemsFromArtifact" must be a non-empty trimmed string.`,
      )
    }
  }
}

export function validateStepGuardrailsConfig(
  id: string,
  phase: 'beforeStep' | 'afterStep',
  guardrails: unknown,
): void {
  if (guardrails === undefined) {
    return
  }
  if (typeof guardrails === 'function') {
    return
  }
  if (!Array.isArray(guardrails) && !(phase === 'beforeStep' && typeof guardrails === 'object' && guardrails !== null)) {
    throw new HarnessConfigError(
      `Step "${id}" "${phase}" property must be an array when provided.`,
    )
  }
  const entries: Array<[string, unknown]> = Array.isArray(guardrails)
    ? guardrails.map((value, index) => [
        String(index),
        value,
      ])
    : Object.entries(guardrails as Record<string, unknown>)
  for (const [key, value] of entries) {
    if (!isGuardrail(value)) {
      const location = Array.isArray(guardrails)
        ? `index ${key}`
        : `key "${key}"`
      throw new HarnessConfigError(
        `Step "${id}" ${phase} at ${location} must be a valid Guardrail instance.`,
      )
    }
  }
}

export function validateStepRetriesConfig(id: string, step: Record<string, unknown>): void {
  if (
    step.onMaxRetriesExceeded !== undefined
    && step.onMaxRetriesExceeded !== 'abort'
    && step.onMaxRetriesExceeded !== 'prompt_user'
  ) {
    throw new HarnessConfigError(
      `Step "${id}" "onMaxRetriesExceeded" must be "abort" or "prompt_user", received ${String(step.onMaxRetriesExceeded)}.`,
    )
  }
}

export function validateStep(step: unknown, index: number, seenIds: Set<string>): void {
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

  validateCwdConfig(rawStep.cwd, `Step "${id}"`)
  validateEnvConfig(rawStep.env, `Step "${id}"`)

  validateStepRetriesConfig(id, rawStep)
  validateStepArtifactsConfig(id, rawStep.artifacts)
  validateStepMatrixConfig(id, rawStep.matrix)
  validateStepGuardrailsConfig(id, 'beforeStep', rawStep.beforeStep)
  validateStepGuardrailsConfig(id, 'afterStep', rawStep.afterStep)

  if (typeof rawStep.run !== 'function' && !isAgentRunner(rawStep.run)) {
    throw new HarnessConfigError(
      `Step "${id}" must have a valid "run" property (function or AgentRunner).`,
    )
  }
}
