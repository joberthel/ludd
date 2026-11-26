import type { EmbeddedMcpServer } from '../types/artifact.js'
import type { StepContext } from '../types/context.js'
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
import {
  getEffectiveMaxRetries,
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
  initialPrompt: string
  mcpServer?: Pick<EmbeddedMcpServer, 'url' | 'authToken'>
  cwd?: string
  env?: Record<string, string>
  signal?: AbortSignal
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
    ...(ctx.matrix !== undefined
      ? { matrixTotal: ctx.matrix.total }
      : {}),
  })
}

export { formatGuardrailRetryPrompt }

async function executeGuardrail(
  guardrail: Guardrail<any, any>,
  params: RunAfterStepGuardrailsParams,
  guardrailIndex: number,
): Promise<GuardrailVerdict> {
  const { ctx, step, attempt, runDir, mcpServer, cwd, env, signal, gateWaiter } = params
  return guardrail.execute({
    ctx,
    stepId: step.id,
    phase: 'afterStep',
    guardrailIndex,
    attempt,
    runDir,
    cwd: cwd ?? process.cwd(),
    env: env ?? {},
    signal: signal ?? gateWaiter?.signal,
    mcpServerUrl: mcpServer?.url ?? '',
    mcpAuthToken: mcpServer?.authToken ?? '',
  })
}

function triggerGuardrailRetry(
  params: RunAfterStepGuardrailsParams,
  k: number,
  verdict: GuardrailVerdict,
  feedback?: string,
): never {
  const { runDir, ctx, step, sessionId, attempt, initialPrompt, mcpServer } = params
  const nextAttempt = attempt + 1
  ctx.step.attempt = nextAttempt

  emitStepRetry(runDir, ctx, step.id, sessionId ?? '', nextAttempt, 'guardrail_failed', {
    guardrailIndex: k,
    verdict,
  })

  const retryPrompt = formatGuardrailRetryPrompt(initialPrompt, k, verdict, mcpServer?.url, feedback)
  throw new GuardrailRetrySignal(retryPrompt)
}

async function handleGuardrailFailure(
  k: number,
  guardrail: Guardrail<any, any>,
  verdict: GuardrailVerdict,
  params: RunAfterStepGuardrailsParams,
): Promise<GuardrailVerdict> {
  const { step, snapshot, runDir } = params
  const count = checkGuardrailRetries(snapshot, k, runDir)
  const isAgent = params.isAgent ?? isAgentRunner(step.run)
  const maxRetries = getEffectiveMaxRetries(guardrail, step.id, k, snapshot)

  if (!isAgent || count > maxRetries) {
    return handleGuardrailEscalation(params, k, guardrail, verdict)
  }

  const feedback = guardrail.type === 'human_review' && typeof verdict.body === 'string'
    ? verdict.body
    : undefined
  triggerGuardrailRetry(params, k, verdict, feedback)
}

async function processGuardrailResult(
  guardrail: Guardrail<any, any>,
  k: number,
  params: RunAfterStepGuardrailsParams,
): Promise<void> {
  const { step, ctx, runDir, attempt, snapshot, logStore } = params
  const guardrailNameField = guardrail.name !== undefined
    ? { guardrailName: guardrail.name }
    : {}
  emitGuardrailEvent(runDir, ctx, step.id, 'guardrail.started', {
    phase: 'afterStep',
    guardrailIndex: k,
    attempt,
    ...guardrailNameField,
    ...(ctx.matrix !== undefined
      ? { matrixTotal: ctx.matrix.total }
      : {}),
  })
  if (params.rehydratedGate?.guardrailIndex === k && params.rehydratedGate.gateType === 'max_retries_exceeded') {
    const verdict: GuardrailVerdict = {
      status: 'fail',
      body: params.rehydratedGate.prompt,
      ...(params.rehydratedGate.logKey !== undefined
        ? { logKey: params.rehydratedGate.logKey }
        : {}),
    }
    await handleGuardrailEscalation(params, k, guardrail, verdict)
    return
  }
  const verdict = guardrail.type === 'human_review'
    ? await executeHumanReviewAfterStepGuardrail(params, guardrail, k)
    : await executeGuardrail(guardrail, params, k)

  if (verdict.status === 'pass' || verdict.status === 'skip') {
    const eventType = verdict.status === 'pass'
      ? 'guardrail.passed'
      : 'guardrail.skipped'
    emitGuardrailEvent(runDir, ctx, step.id, eventType, {
      phase: 'afterStep',
      guardrailIndex: k,
      attempt,
      ...guardrailNameField,
      verdict,
    })
    return
  }

  await offloadGuardrailLog(runDir, snapshot, step.id, attempt, 'afterStep', k, verdict, logStore, ctx.matrix?.index)
  emitGuardrailEvent(runDir, ctx, step.id, 'guardrail.failed', {
    phase: 'afterStep',
    guardrailIndex: k,
    attempt,
    ...guardrailNameField,
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
