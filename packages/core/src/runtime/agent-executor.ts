import type { AgentAccessMode, AgentRunner } from '../types/agent.js'
import type { EmbeddedMcpServer } from '../types/artifact.js'
import type { DynamicProperty, StepContext } from '../types/context.js'
import type { StepConfig } from '../types/harness.js'
import type { RunStateSnapshot } from '../types/state.js'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import {
  DEFAULT_MAX_TOTAL_TURNS,
  MaxTotalTurnsExceededError,
} from '../errors/max-total-turns-exceeded-error.js'
import { StepOutputValidationError } from '../errors/step-output-validation-error.js'
import { appendLedgerEvent, readLedgerEvents } from '../persistence/ledger-writer.js'
import { writeRunStateAtomic } from '../persistence/state-store.js'
import { appendStreamEvent } from '../persistence/stream-writer.js'
import { resolveDynamicProperty } from '../utils/resolve-dynamic-property.js'

export interface RehydratedAgentState {
  sessionId?: string | null
  attempt?: number
}

type RetryIssueList = readonly { path?: readonly (string | number | symbol)[], message: string }[]

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
  if (typeof validatedOutput === 'object' && validatedOutput !== null && !Array.isArray(validatedOutput)) {
    return { ...(validatedOutput as Record<string, unknown>), sessionId }
  }
  return { value: validatedOutput, sessionId }
}

export function formatRetryPrompt(initialPrompt: string, issues: RetryIssueList): string {
  const formatted = issues.map((i) => {
    const p = i.path && i.path.length > 0
      ? i.path.map(String).join('.')
      : '(root)'
    return `- [${p}]: ${i.message}`
  }).join('\n')
  return `Your previous output did not match the required schema:\n${formatted}\n\nPlease correct your output to conform to the schema.\n\nOriginal instruction:\n${initialPrompt}`
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
  if (trimmed !== undefined && trimmed !== '') {
    return trimmed
  }
  return `session-${randomUUID()}`
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
    payload: { sessionId, streamPath: `streams/${sessionId}.jsonl`, attempt },
  })
  appendStreamEvent(runDir, sessionId, {
    schemaVersion: 1,
    timestamp: new Date().toISOString(),
    runId: ctx.runId,
    stepId,
    sessionId,
    attempt,
    eventType: 'turn.started',
    payload: { prompt, mode },
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
    payload: { output },
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

function resolveInitialPrompt(
  initialPrompt: string,
  runDir: string,
  stepId: string,
  rehydration?: RehydratedAgentState,
): string {
  if (rehydration?.attempt === undefined || rehydration.attempt <= 1) {
    return initialPrompt
  }
  const ledgerPath = path.join(runDir, 'ledger.jsonl')
  if (fs.existsSync(ledgerPath)) {
    const events = readLedgerEvents(runDir)
    const lastRetry = events.reverse().find(e => e.eventType === 'step.retry' && e.stepId === stepId)
    if (lastRetry) {
      const payload = lastRetry.payload as { issues: RetryIssueList }
      return formatRetryPrompt(initialPrompt, payload.issues)
    }
  }
  return initialPrompt
}

function checkTurnBreaker(err: unknown, stepId: string, maxTotalTurns: number, attempt: number): StepOutputValidationError {
  if (!(err instanceof StepOutputValidationError)) {
    throw err
  }
  if (attempt >= maxTotalTurns) {
    throw new MaxTotalTurnsExceededError(stepId, maxTotalTurns, err)
  }
  return err
}

export async function executeAgentStep(
  step: StepConfig,
  agent: AgentRunner,
  ctx: StepContext,
  snapshot: RunStateSnapshot,
  runDir: string,
  rehydration?: RehydratedAgentState,
  mcpServer?: Pick<EmbeddedMcpServer, 'url' | 'authToken'>,
): Promise<unknown> {
  const initialPrompt = await resolveDynamicProperty(agent.prompt, ctx)
  const sessionId = rehydration?.sessionId ?? await resolveSessionId(agent.sessionId, ctx)
  const maxTotalTurns = step.maxTotalTurns ?? DEFAULT_MAX_TOTAL_TURNS

  let attempt = rehydration?.attempt ?? 1
  let currentPrompt = resolveInitialPrompt(initialPrompt, runDir, step.id, rehydration)

  while (true) {
    ctx.step.attempt = attempt
    snapshot.activeSessionId = sessionId
    snapshot.activeStepAttempt = attempt
    snapshot.updatedAt = new Date().toISOString()
    writeRunStateAtomic(runDir, snapshot)

    emitPreTurnEvents(runDir, ctx, step.id, sessionId, currentPrompt, agent.mode, attempt)
    const turnResult = await agent.executeTurn({
      ctx,
      stepId: step.id,
      prompt: currentPrompt,
      sessionId,
      attempt,
      mode: agent.mode,
      runDir,
      mcpServerUrl: mcpServer?.url ?? '',
      mcpAuthToken: mcpServer?.authToken ?? '',
    })
    emitTurnCompleted(runDir, ctx, step.id, sessionId, turnResult.output, attempt)

    try {
      const validatedOutput = await validateStepOutput(step.id, step.outputSchema, turnResult.output)
      return createAgentStepOutput(validatedOutput, turnResult.sessionId)
    }
    catch (err: unknown) {
      const validationError = checkTurnBreaker(err, step.id, maxTotalTurns, attempt)
      attempt += 1
      ctx.step.attempt = attempt
      emitStepRetry(runDir, ctx, step.id, sessionId, attempt, validationError.issues)
      currentPrompt = formatRetryPrompt(initialPrompt, validationError.issues)
    }
  }
}
