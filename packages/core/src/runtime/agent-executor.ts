import type { AgentRunner } from '../types/agent.js'
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

export function createAgentStepOutput(
  validatedOutput: unknown,
  sessionId: string,
): unknown {
  if (
    typeof validatedOutput === 'object'
    && validatedOutput !== null
    && !Array.isArray(validatedOutput)
  ) {
    return {
      ...(validatedOutput as Record<string, unknown>),
      sessionId,
    }
  }
  return {
    value: validatedOutput,
    sessionId,
  }
}

async function resolveSessionId(
  sessionIdProp: DynamicProperty<string | undefined> | undefined,
  ctx: StepContext,
): Promise<string> {
  if (sessionIdProp === undefined) {
    return `session-${randomUUID()}`
  }
  const resolved = await resolveDynamicProperty(sessionIdProp, ctx)
  const trimmed = resolved?.trim()
  if (trimmed === undefined || trimmed === '') {
    return `session-${randomUUID()}`
  }
  return trimmed
}

export async function executeAgentStep(
  step: StepConfig,
  agent: AgentRunner,
  ctx: StepContext,
  runDir: string,
): Promise<unknown> {
  const prompt = await resolveDynamicProperty(agent.prompt, ctx)
  const sessionId = await resolveSessionId(agent.sessionId, ctx)

  const turnResult = await agent.executeTurn({
    ctx,
    stepId: step.id,
    prompt,
    sessionId,
    attempt: 1,
    mode: agent.mode,
    runDir,
  })

  const validatedOutput = await validateStepOutput(step.id, step.outputSchema, turnResult.output)
  return createAgentStepOutput(validatedOutput, turnResult.sessionId)
}
