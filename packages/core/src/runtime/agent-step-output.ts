import type { DynamicProperty, StepContext } from '../types/context.js'
import type { StepConfig } from '../types/harness.js'
import { randomUUID } from 'node:crypto'
import { StepOutputValidationError } from '../errors/step-output-validation-error.js'
import { resolveDynamicProperty } from '../utils/resolve-dynamic-property.js'

export async function validateStepOutput(
  stepId: string,
  schema: StepConfig['outputSchema'],
  rawOutput: unknown,
): Promise<unknown> {
  if (schema === undefined) {
    return rawOutput
  }
  const parsed = await schema.safeParseAsync(rawOutput)
  if (!parsed.success) {
    throw new StepOutputValidationError(stepId, rawOutput, parsed.error.issues)
  }
  return parsed.data
}

export function createAgentStepOutput(validatedOutput: unknown, sessionId: string): unknown {
  const isObj = typeof validatedOutput === 'object' && validatedOutput !== null && !Array.isArray(validatedOutput)
  return isObj
    ? { ...(validatedOutput as Record<string, unknown>), sessionId }
    : { value: validatedOutput, sessionId }
}

export async function resolveSessionId(
  sessionIdProp: DynamicProperty<string | undefined> | undefined,
  ctx: StepContext,
): Promise<string> {
  if (sessionIdProp !== undefined) {
    const raw = await resolveDynamicProperty(sessionIdProp, ctx)
    const trimmed = raw?.trim()
    if (trimmed !== undefined && trimmed.length > 0) {
      return trimmed
    }
  }
  return `session-${randomUUID()}`
}
