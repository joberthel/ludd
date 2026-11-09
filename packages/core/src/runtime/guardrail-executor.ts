import type { EmbeddedMcpServer } from '../types/artifact.js'
import type { ProvisionedEnvironment, StepContext } from '../types/context.js'
import type { Guardrail, GuardrailVerdict } from '../types/guardrail.js'
import type { StepConfig } from '../types/harness.js'
import type { LedgerEventType } from '../types/ledger.js'
import type { LogStore } from '../types/log.js'
import type { RunStateSnapshot } from '../types/state.js'
import process from 'node:process'
import { GuardrailMaxRetriesExceededError } from '../errors/guardrail-max-retries-exceeded-error.js'
import { MaxTotalTurnsExceededError } from '../errors/max-total-turns-exceeded-error.js'
import { offloadGuardrailLog } from '../mcp/log-store.js'
import { appendLedgerEvent } from '../persistence/ledger-writer.js'
import { writeRunStateAtomic } from '../persistence/state-store.js'
import { isAgentRunner } from '../types/harness.js'
import { createDefaultHostEnvironment, resolveGuardrailEnvironment } from './environment-manager.js'

export type StepRetryReason
  = | 'output_schema_validation_failed'
    | 'artifact_validation_failed'
    | 'guardrail_failed'

export class GuardrailRetrySignal {
  readonly prompt: string

  constructor(prompt: string) {
    this.prompt = prompt
  }
}

export interface RunAfterStepGuardrailsParams {
  step: StepConfig
  ctx: StepContext
  snapshot: RunStateSnapshot
  runDir: string
  attempt: number
  sessionId?: string
  maxTotalTurns: number
  initialPrompt: string
  mcpServer?: Pick<EmbeddedMcpServer, 'url' | 'authToken'>
  environment?: ProvisionedEnvironment
  logStore?: LogStore
}

function emitGuardrailEvent(
  runDir: string,
  ctx: StepContext,
  stepId: string,
  eventType: LedgerEventType,
  payload: Record<string, unknown>,
): void {
  appendLedgerEvent(runDir, {
    schemaVersion: 1,
    timestamp: new Date().toISOString(),
    runId: ctx.runId,
    stepId,
    matrixIndex: ctx.matrix?.index,
    eventType,
    payload,
  })
}

export function emitStepRetry(
  runDir: string,
  ctx: StepContext,
  stepId: string,
  sessionId: string,
  attempt: number,
  reason: StepRetryReason,
  issues: unknown,
): void {
  emitGuardrailEvent(runDir, ctx, stepId, 'step.retry', {
    attempt,
    sessionId,
    reason,
    issues,
  })
}

export function formatGuardrailRetryPrompt(
  initialPrompt: string,
  guardrailIndex: number,
  verdict: GuardrailVerdict<unknown>,
  mcpServerUrl?: string,
): string {
  if (verdict.logKey !== undefined) {
    const summary = typeof verdict.body === 'string' && verdict.body.length > 0
      ? `\nSummary: ${verdict.body}`
      : ''
    const serverNotice = typeof mcpServerUrl === 'string' && mcpServerUrl.length > 0
      ? ` at ${mcpServerUrl}`
      : ''
    return [
      `The step failed afterStep guardrail #${guardrailIndex}.${summary}`,
      `Detailed failure log has been offloaded to MCP logKey "${verdict.logKey}"${serverNotice}.`,
      `Use the MCP log tools (read_log_page, read_log_lines, search_log) to inspect the logs without loading the full output into context.`,
      `Please fix the issues and try again.`,
      `Original instruction:\n${initialPrompt}`,
    ].join('\n\n')
  }

  const rawLog = verdict.rawLog
  const hasLog = typeof rawLog === 'string' && rawLog.length > 0
  const details = hasLog
    ? `\nLog output:\n${rawLog}`
    : verdict.body !== undefined
      ? `\nDetails: ${typeof verdict.body === 'string'
        ? verdict.body
        : JSON.stringify(verdict.body)}`
      : ''
  return `The step failed afterStep guardrail #${guardrailIndex}.${details}\n\nPlease fix the issues and try again.\n\nOriginal instruction:\n${initialPrompt}`
}

async function resolveGuardrailEnv(
  guardrail: Guardrail<any, any>,
  ctx: StepContext,
  stepId: string,
  stepEnvironment?: ProvisionedEnvironment,
): Promise<ProvisionedEnvironment> {
  const fallback = stepEnvironment
    ?? ctx.environments[stepId]
    ?? ctx.environments.host
    ?? createDefaultHostEnvironment(process.cwd())
  return resolveGuardrailEnvironment(guardrail, ctx, fallback)
}

async function executeGuardrail(
  guardrail: Guardrail<any, any>,
  ctx: StepContext,
  stepId: string,
  guardrailIndex: number,
  attempt: number,
  runDir: string,
  mcpServer?: Pick<EmbeddedMcpServer, 'url' | 'authToken'>,
  stepEnvironment?: ProvisionedEnvironment,
): Promise<GuardrailVerdict> {
  const env = await resolveGuardrailEnv(guardrail, ctx, stepId, stepEnvironment)
  return guardrail.execute({
    ctx,
    stepId,
    phase: 'afterStep',
    guardrailIndex,
    attempt,
    runDir,
    environment: env,
    mcpServerUrl: mcpServer?.url ?? '',
    mcpAuthToken: mcpServer?.authToken ?? '',
  })
}

function clearActiveGuardrailRetries(runDir: string, snapshot: RunStateSnapshot): void {
  if (snapshot.activeGuardrailRetries !== undefined) {
    snapshot.activeGuardrailRetries = undefined
    snapshot.updatedAt = new Date().toISOString()
    writeRunStateAtomic(runDir, snapshot)
  }
}

function handleGuardrailFailure(
  k: number,
  guardrail: Guardrail<any, any>,
  verdict: GuardrailVerdict,
  params: RunAfterStepGuardrailsParams,
): never {
  const { step, snapshot, runDir, attempt, sessionId, maxTotalTurns, initialPrompt, ctx, mcpServer } = params
  if (!snapshot.activeGuardrailRetries) {
    snapshot.activeGuardrailRetries = {}
  }
  const key = String(k)
  const count = (snapshot.activeGuardrailRetries[key] ?? 0) + 1
  snapshot.activeGuardrailRetries[key] = count
  snapshot.updatedAt = new Date().toISOString()
  writeRunStateAtomic(runDir, snapshot)

  const isAgent = isAgentRunner(step.run)
  const maxRetries = guardrail.maxRetries ?? 0

  if (!isAgent || count > maxRetries) {
    throw new GuardrailMaxRetriesExceededError(step.id, k, maxRetries, verdict)
  }

  if (attempt >= maxTotalTurns) {
    throw new MaxTotalTurnsExceededError(step.id, maxTotalTurns)
  }

  const nextAttempt = attempt + 1
  ctx.step.attempt = nextAttempt

  emitStepRetry(runDir, ctx, step.id, sessionId ?? '', nextAttempt, 'guardrail_failed', {
    guardrailIndex: k,
    verdict,
  })

  const retryPrompt = formatGuardrailRetryPrompt(initialPrompt, k, verdict, mcpServer?.url)
  throw new GuardrailRetrySignal(retryPrompt)
}

async function processGuardrailResult(
  guardrail: Guardrail<any, any>,
  k: number,
  params: RunAfterStepGuardrailsParams,
): Promise<void> {
  const { step, ctx, runDir, attempt, mcpServer, snapshot, environment, logStore } = params
  emitGuardrailEvent(runDir, ctx, step.id, 'guardrail.started', { phase: 'afterStep', guardrailIndex: k, attempt })
  const verdict = await executeGuardrail(guardrail, ctx, step.id, k, attempt, runDir, mcpServer, environment)

  if (verdict.status === 'pass' || verdict.status === 'skip') {
    const eventType = verdict.status === 'pass'
      ? 'guardrail.passed'
      : 'guardrail.skipped'
    emitGuardrailEvent(runDir, ctx, step.id, eventType, {
      phase: 'afterStep',
      guardrailIndex: k,
      attempt,
      verdict,
    })
    return
  }

  await offloadGuardrailLog(runDir, snapshot, step.id, attempt, 'afterStep', k, verdict, logStore)
  emitGuardrailEvent(runDir, ctx, step.id, 'guardrail.failed', {
    phase: 'afterStep',
    guardrailIndex: k,
    attempt,
    verdict,
  })
  handleGuardrailFailure(k, guardrail, verdict, params)
}

export async function runAfterStepGuardrails(
  params: RunAfterStepGuardrailsParams,
): Promise<void> {
  const { step, snapshot, runDir } = params
  if (!step.afterStep || step.afterStep.length === 0) {
    clearActiveGuardrailRetries(runDir, snapshot)
    return
  }

  for (let k = 0; k < step.afterStep.length; k++) {
    await processGuardrailResult(step.afterStep[k], k, params)
  }

  clearActiveGuardrailRetries(runDir, snapshot)
}
