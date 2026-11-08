import type { AgentAccessMode, AgentRunner } from '../types/agent.js'
import type { DynamicProperty, StepContext } from '../types/context.js'
import type { StepConfig } from '../types/harness.js'
import { randomUUID } from 'node:crypto'
import { StepOutputValidationError } from '../errors/step-output-validation-error.js'
import { appendLedgerEvent } from '../persistence/ledger-writer.js'
import { appendStreamEvent } from '../persistence/stream-writer.js'
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

function emitPreTurnEvents(
  runDir: string,
  ctx: StepContext,
  stepId: string,
  sessionId: string,
  prompt: string,
  mode: AgentAccessMode,
  attempt: number,
): void {
  appendLedgerEvent(runDir, {
    schemaVersion: 1,
    timestamp: new Date().toISOString(),
    runId: ctx.runId,
    stepId,
    eventType: 'agent.stream.linked',
    payload: {
      sessionId,
      streamPath: `streams/${sessionId}.jsonl`,
      attempt,
    },
  })

  appendStreamEvent(runDir, sessionId, {
    schemaVersion: 1,
    timestamp: new Date().toISOString(),
    runId: ctx.runId,
    stepId,
    sessionId,
    attempt,
    eventType: 'turn.started',
    payload: {
      prompt,
      mode,
    },
  })
}

function emitPostTurnEvent(
  runDir: string,
  ctx: StepContext,
  stepId: string,
  sessionId: string,
  output: unknown,
  attempt: number,
): void {
  appendStreamEvent(runDir, sessionId, {
    schemaVersion: 1,
    timestamp: new Date().toISOString(),
    runId: ctx.runId,
    stepId,
    sessionId,
    attempt,
    eventType: 'turn.completed',
    payload: {
      output,
    },
  })
}

export async function executeAgentStep(
  step: StepConfig,
  agent: AgentRunner,
  ctx: StepContext,
  runDir: string,
): Promise<unknown> {
  const prompt = await resolveDynamicProperty(agent.prompt, ctx)
  const sessionId = await resolveSessionId(agent.sessionId, ctx)
  const attempt = 1

  emitPreTurnEvents(runDir, ctx, step.id, sessionId, prompt, agent.mode, attempt)

  const turnResult = await agent.executeTurn({
    ctx,
    stepId: step.id,
    prompt,
    sessionId,
    attempt,
    mode: agent.mode,
    runDir,
  })

  emitPostTurnEvent(runDir, ctx, step.id, sessionId, turnResult.output, attempt)

  const validatedOutput = await validateStepOutput(step.id, step.outputSchema, turnResult.output)
  return createAgentStepOutput(validatedOutput, turnResult.sessionId)
}
