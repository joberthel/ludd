import type { AgentRunner } from '../types/agent.js'
import type { StepContext } from '../types/context.js'
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

export async function executeAgentStep(
  step: StepConfig,
  agent: AgentRunner,
  ctx: StepContext,
  runDir: string,
): Promise<unknown> {
  const prompt = await resolveDynamicProperty(agent.prompt, ctx)
  const resolvedSessionId = agent.sessionId !== undefined
    ? await resolveDynamicProperty(agent.sessionId, ctx)
    : undefined
  const sessionId = resolvedSessionId ?? `session-${randomUUID()}`

  const turnResult = await agent.executeTurn({
    ctx,
    stepId: step.id,
    prompt,
    sessionId,
    attempt: 1,
    mode: agent.mode,
    runDir,
  })

  return validateStepOutput(step.id, step.outputSchema, turnResult.output)
}
