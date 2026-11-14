import type { EmbeddedMcpServer } from '../types/artifact.js'
import type { ProvisionedEnvironment, StepContext } from '../types/context.js'
import type { Guardrail, GuardrailVerdict } from '../types/guardrail.js'
import type { StepConfig } from '../types/harness.js'
import type { LedgerEventType } from '../types/ledger.js'
import type { LogStore } from '../types/log.js'
import type { ActiveGateState, RunStateSnapshot } from '../types/state.js'
import type { GateWaiter } from './gate-waiter.js'
import process from 'node:process'
import { offloadGuardrailLog } from '../mcp/log-store.js'
import { appendLedgerEvent } from '../persistence/ledger-writer.js'
import { isGuardrail } from '../types/guardrail.js'
import { isAgentRunner } from '../types/harness.js'
import { executeHumanReviewAfterStepGuardrail } from './after-step-human-review.js'
import { createDefaultHostEnvironment, resolveGuardrailEnvironment } from './environment-manager.js'
import {
  getEffectiveMaxRetries,
  getEffectiveMaxTotalTurns,
  handleGuardrailEscalation,
} from './escalation-manager.js'
import { checkGuardrailRetries, clearActiveGuardrailRetries } from './guardrail-retries.js'
import { formatGuardrailRetryPrompt } from './guardrail-retry-prompt.js'
import { GuardrailRetrySignal } from './guardrail-retry-signal.js'

export type StepRetryReason
  = | 'output_schema_validation_failed'
    | 'artifact_validation_failed'
    | 'guardrail_failed'

export { GuardrailRetrySignal }

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
  gateWaiter?: GateWaiter
  startGuardrailIndex?: number
  isAgent?: boolean
  rehydratedGate?: ActiveGateState | null
}

export function emitGuardrailEvent(
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

export { formatGuardrailRetryPrompt }

async function resolveGuardrailEnv(
  guardrail: Guardrail<any, any>,
  ctx: StepContext,
  stepId: string,
  stepEnvironment?: ProvisionedEnvironment,
  snapshot?: RunStateSnapshot,
  runDir?: string,
): Promise<ProvisionedEnvironment> {
  const fallback = stepEnvironment
    ?? ctx.environments[stepId]
    ?? ctx.environments.host
    ?? createDefaultHostEnvironment(process.cwd())
  return resolveGuardrailEnvironment(guardrail, ctx, fallback, snapshot, runDir)
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
  snapshot?: RunStateSnapshot,
): Promise<GuardrailVerdict> {
  const env = await resolveGuardrailEnv(guardrail, ctx, stepId, stepEnvironment, snapshot, runDir)
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

function triggerGuardrailRetry(
  params: RunAfterStepGuardrailsParams,
  k: number,
  verdict: GuardrailVerdict,
): never {
  const { runDir, ctx, step, sessionId, attempt, initialPrompt, mcpServer } = params
  const nextAttempt = attempt + 1
  ctx.step.attempt = nextAttempt

  emitStepRetry(runDir, ctx, step.id, sessionId ?? '', nextAttempt, 'guardrail_failed', {
    guardrailIndex: k,
    verdict,
  })

  const retryPrompt = formatGuardrailRetryPrompt(initialPrompt, k, verdict, mcpServer?.url)
  throw new GuardrailRetrySignal(retryPrompt)
}

async function handleGuardrailFailure(
  k: number,
  guardrail: Guardrail<any, any>,
  verdict: GuardrailVerdict,
  params: RunAfterStepGuardrailsParams,
): Promise<GuardrailVerdict> {
  const { step, snapshot, runDir, attempt, maxTotalTurns } = params
  const count = checkGuardrailRetries(snapshot, k, runDir)
  const isAgent = params.isAgent ?? isAgentRunner(step.run)
  const maxRetries = getEffectiveMaxRetries(guardrail, step.id, k, snapshot)
  const effectiveMaxTotalTurns = getEffectiveMaxTotalTurns(maxTotalTurns, step.id, snapshot)

  const isGuardrailRetriesExceeded = !isAgent || count > maxRetries
  const isMaxTotalTurnsExceeded = attempt >= effectiveMaxTotalTurns

  if (isGuardrailRetriesExceeded || isMaxTotalTurnsExceeded) {
    const reason = isGuardrailRetriesExceeded ? 'guardrail_max_retries' : 'max_total_turns'
    return handleGuardrailEscalation(params, k, guardrail, verdict, reason)
  }

  triggerGuardrailRetry(params, k, verdict)
}

async function processGuardrailResult(
  guardrail: Guardrail<any, any>,
  k: number,
  params: RunAfterStepGuardrailsParams,
): Promise<void> {
  const { step, ctx, runDir, attempt, mcpServer, snapshot, environment, logStore } = params
  emitGuardrailEvent(runDir, ctx, step.id, 'guardrail.started', { phase: 'afterStep', guardrailIndex: k, attempt })
  if (params.rehydratedGate?.guardrailIndex === k && params.rehydratedGate.gateType === 'max_retries_exceeded') {
    const verdict: GuardrailVerdict = { status: 'fail', body: params.rehydratedGate.prompt }
    await handleGuardrailEscalation(params, k, guardrail, verdict, 'guardrail_max_retries')
    return
  }
  const verdict = guardrail.type === 'human_review'
    ? await executeHumanReviewAfterStepGuardrail(params, guardrail, k)
    : await executeGuardrail(guardrail, ctx, step.id, k, attempt, runDir, mcpServer, environment, snapshot)

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

  await offloadGuardrailLog(runDir, snapshot, step.id, attempt, 'afterStep', k, verdict, logStore, ctx.matrix?.index)
  emitGuardrailEvent(runDir, ctx, step.id, 'guardrail.failed', {
    phase: 'afterStep',
    guardrailIndex: k,
    attempt,
    verdict,
  })
  await handleGuardrailFailure(k, guardrail, verdict, params)
}

export async function runAfterStepGuardrails(
  params: RunAfterStepGuardrailsParams,
): Promise<void> {
  const { step, snapshot, runDir } = params
  const afterStep = typeof step.afterStep === 'function'
    ? await step.afterStep(params.ctx)
    : step.afterStep
  if (afterStep !== undefined && !Array.isArray(afterStep)) {
    throw new TypeError(`Step "${step.id}" afterStep factory must return an array.`)
  }
  if (!afterStep || afterStep.length === 0) {
    clearActiveGuardrailRetries(runDir, snapshot)
    return
  }

  const startIndex = params.startGuardrailIndex ?? 0
  for (let k = startIndex; k < afterStep.length; k++) {
    const guardrail: unknown = afterStep[k]
    if (!isGuardrail(guardrail)) {
      throw new TypeError(`Step "${step.id}" afterStep factory returned an invalid Guardrail at index ${k}.`)
    }
    await processGuardrailResult(guardrail, k, params)
  }

  clearActiveGuardrailRetries(runDir, snapshot)
}
