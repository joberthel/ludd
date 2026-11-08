import type { AgentAccessMode, AgentRunner } from '../types/agent.js'
import type { DynamicProperty, StepContext } from '../types/context.js'
import type { StepConfig } from '../types/harness.js'
import { randomUUID } from 'node:crypto'
import {
  DEFAULT_MAX_TOTAL_TURNS,
  MaxTotalTurnsExceededError,
} from '../errors/max-total-turns-exceeded-error.js'
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

export function formatRetryPrompt(
  initialPrompt: string,
  issues: readonly { path?: readonly (string | number | symbol)[], message: string }[],
): string {
  const formattedIssues = issues
    .map((issue) => {
      const fieldPath = issue.path && issue.path.length > 0
        ? issue.path.map(String).join('.')
        : '(root)'
      return `- [${fieldPath}]: ${issue.message}`
    })
    .join('\n')

  return `Your previous output did not match the required schema:\n${formattedIssues}\n\nPlease correct your output to conform to the schema.\n\nOriginal instruction:\n${initialPrompt}`
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

function emitStreamLinked(
  runDir: string,
  ctx: StepContext,
  stepId: string,
  sessionId: string,
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
}

function emitTurnStarted(
  runDir: string,
  ctx: StepContext,
  stepId: string,
  sessionId: string,
  prompt: string,
  mode: AgentAccessMode,
  attempt: number,
): void {
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

function emitTurnCompleted(
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

function emitStepRetry(
  runDir: string,
  ctx: StepContext,
  stepId: string,
  sessionId: string,
  attempt: number,
  issues: unknown,
): void {
  appendLedgerEvent(runDir, {
    schemaVersion: 1,
    timestamp: new Date().toISOString(),
    runId: ctx.runId,
    stepId,
    eventType: 'step.retry',
    payload: {
      attempt,
      sessionId,
      reason: 'output_schema_validation_failed',
      issues,
    },
  })
}

export async function executeAgentStep(
  step: StepConfig,
  agent: AgentRunner,
  ctx: StepContext,
  runDir: string,
): Promise<unknown> {
  const initialPrompt = await resolveDynamicProperty(agent.prompt, ctx)
  const sessionId = await resolveSessionId(agent.sessionId, ctx)
  const maxTotalTurns = step.maxTotalTurns ?? DEFAULT_MAX_TOTAL_TURNS

  let attempt = 1
  let currentPrompt = initialPrompt

  emitStreamLinked(runDir, ctx, step.id, sessionId, attempt)

  while (true) {
    ctx.step.attempt = attempt

    emitTurnStarted(runDir, ctx, step.id, sessionId, currentPrompt, agent.mode, attempt)

    const turnResult = await agent.executeTurn({
      ctx,
      stepId: step.id,
      prompt: currentPrompt,
      sessionId,
      attempt,
      mode: agent.mode,
      runDir,
    })

    emitTurnCompleted(runDir, ctx, step.id, sessionId, turnResult.output, attempt)

    try {
      const validatedOutput = await validateStepOutput(
        step.id,
        step.outputSchema,
        turnResult.output,
      )
      return createAgentStepOutput(validatedOutput, turnResult.sessionId)
    }
    catch (err: unknown) {
      if (!(err instanceof StepOutputValidationError)) {
        throw err
      }
      if (attempt >= maxTotalTurns) {
        throw new MaxTotalTurnsExceededError(step.id, maxTotalTurns, err)
      }

      attempt += 1
      ctx.step.attempt = attempt
      emitStepRetry(runDir, ctx, step.id, sessionId, attempt, err.issues)
      currentPrompt = formatRetryPrompt(initialPrompt, err.issues)
    }
  }
}
