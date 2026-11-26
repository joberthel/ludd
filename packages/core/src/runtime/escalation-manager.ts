import type { Guardrail, GuardrailVerdict, OnMaxRetriesExceededAction } from '../types/guardrail.js'
import type { StepConfig } from '../types/harness.js'
import type { GateResolveParams } from '../types/ipc.js'
import type { ActiveGateState, RunStateSnapshot } from '../types/state.js'
import type { RunAfterStepGuardrailsParams } from './guardrail-executor.js'
import { GuardrailMaxRetriesExceededError } from '../errors/guardrail-max-retries-exceeded-error.js'
import { writeRunStateAtomic } from '../persistence/state-store.js'
import { emitGuardrailEvent, emitStepRetry } from './guardrail-executor.js'
import { formatGuardrailRetryPrompt } from './guardrail-retry-prompt.js'
import { GuardrailRetrySignal } from './guardrail-retry-signal.js'

export function determineEscalationPolicy(
  guardrail: Guardrail<any, any>,
  step: StepConfig,
): OnMaxRetriesExceededAction {
  return guardrail.onMaxRetriesExceeded ?? step.onMaxRetriesExceeded ?? 'abort'
}

export function formatEscalationPrompt(
  stepId: string,
  guardrailIndex: number,
  verdict: GuardrailVerdict,
): string {
  const reasonText = `Guardrail #${guardrailIndex} in step "${stepId}" exceeded maxRetries.`
  const summaryText = typeof verdict.body === 'string'
    ? verdict.body.trim()
    : verdict.body !== undefined
      ? JSON.stringify(verdict.body)
      : ''
  const summary = summaryText.length > 0
    ? `\nSummary: ${summaryText}`
    : ''
  const logKeyNotice = verdict.logKey !== undefined
    ? `\nMCP logKey: "${verdict.logKey}"`
    : ''
  return `${reasonText}${summary}${logKeyNotice}\nChoose pass, skip, or abort.`
}

export function getEffectiveMaxRetries(
  guardrail: Guardrail<any, any>,
  stepId: string,
  guardrailIndex: number,
  snapshot: RunStateSnapshot,
): number {
  if (guardrail.maxRetries === undefined) {
    return Number.POSITIVE_INFINITY
  }
  const extra = snapshot.grantedExtraRetries?.[`${stepId}:${guardrailIndex}`] ?? 0
  return guardrail.maxRetries + extra
}

export function resolveAddRetries(rawAddRetries: number | undefined): number {
  const addRetries = rawAddRetries ?? 1
  if (!Number.isInteger(addRetries) || addRetries < 1) {
    throw new Error(`Invalid addRetries: expected integer >= 1, received ${addRetries}`)
  }
  return addRetries
}

function recordEscalationActiveGate(
  params: RunAfterStepGuardrailsParams,
  guardrailIndex: number,
  prompt: string,
  logKey?: string,
): ActiveGateState {
  const { step, ctx, runDir, snapshot } = params
  const isMatchingExisting = snapshot.activeGate?.guardrailIndex === guardrailIndex
    && snapshot.activeGate?.phase === 'afterStep'
  const activeGate: ActiveGateState = {
    stepId: step.id,
    ...(ctx.matrix?.index !== undefined
      ? { matrixIndex: ctx.matrix.index }
      : {}),
    phase: 'afterStep',
    guardrailIndex,
    gateType: 'max_retries_exceeded',
    prompt,
    ...(logKey !== undefined
      ? { logKey }
      : {}),
    createdAt: isMatchingExisting
      ? snapshot.activeGate!.createdAt
      : new Date().toISOString(),
  }

  snapshot.status = 'waiting_for_gate'
  snapshot.activeGate = activeGate
  snapshot.activeStepOutput = ctx.step.output
  snapshot.updatedAt = new Date().toISOString()
  writeRunStateAtomic(runDir, snapshot)

  emitGuardrailEvent(runDir, ctx, step.id, 'gate.waiting', {
    phase: 'afterStep',
    guardrailIndex,
    gateType: 'max_retries_exceeded',
    prompt,
  })

  return activeGate
}

function resolveEscalationVerdict(
  resolution: GateResolveParams,
  verdict: GuardrailVerdict,
): GuardrailVerdict {
  const status = resolution.action as 'pass' | 'skip'
  return {
    status,
    body: resolution.feedback !== undefined && resolution.feedback.trim() !== ''
      ? resolution.feedback
      : verdict.body,
    logKey: verdict.logKey,
    rawLog: verdict.rawLog,
    logFormat: verdict.logFormat,
  }
}

function handleRetryResolution(
  params: RunAfterStepGuardrailsParams,
  k: number,
  resolution: GateResolveParams,
  verdict: GuardrailVerdict,
): never {
  const { snapshot, runDir, step, ctx, attempt, sessionId, initialPrompt, mcpServer } = params
  const addRetries = resolveAddRetries(resolution.addRetries)

  snapshot.grantedExtraRetries = snapshot.grantedExtraRetries ?? {}
  const retryKey = `${step.id}:${k}`
  snapshot.grantedExtraRetries[retryKey] = (snapshot.grantedExtraRetries[retryKey] ?? 0) + addRetries

  snapshot.status = 'running'
  snapshot.activeGate = null
  snapshot.activeStepOutput = undefined
  snapshot.updatedAt = new Date().toISOString()
  writeRunStateAtomic(runDir, snapshot)

  const nextAttempt = attempt + 1
  ctx.step.attempt = nextAttempt

  const userFeedback = resolution.feedback !== undefined && resolution.feedback.trim() !== ''
    ? resolution.feedback.trim()
    : undefined

  emitStepRetry(runDir, ctx, step.id, sessionId ?? '', nextAttempt, 'guardrail_failed', {
    guardrailIndex: k,
    verdict,
    ...(userFeedback !== undefined
      ? { feedback: userFeedback }
      : {}),
  })

  const retryPrompt = formatGuardrailRetryPrompt(
    initialPrompt,
    k,
    verdict,
    mcpServer?.url,
    userFeedback,
  )

  throw new GuardrailRetrySignal(retryPrompt)
}

function throwMaxRetriesExceeded(
  params: RunAfterStepGuardrailsParams,
  k: number,
  guardrail: Guardrail<any, any>,
  verdict: GuardrailVerdict,
): never {
  const maxRetries = getEffectiveMaxRetries(guardrail, params.step.id, k, params.snapshot)
  throw new GuardrailMaxRetriesExceededError(params.step.id, k, maxRetries, verdict)
}

async function handleEscalationResolution(
  params: RunAfterStepGuardrailsParams,
  k: number,
  guardrail: Guardrail<any, any>,
  verdict: GuardrailVerdict,
  activeGate: ActiveGateState,
): Promise<GuardrailVerdict> {
  const { gateWaiter, runDir, ctx, step, attempt } = params
  const resolution = await gateWaiter!.waitForResolution(activeGate)

  if (resolution.action === 'pass' || resolution.action === 'skip') {
    const resolvedVerdict = resolveEscalationVerdict(resolution, verdict)
    const eventType = resolvedVerdict.status === 'pass'
      ? 'guardrail.passed'
      : 'guardrail.skipped'
    emitGuardrailEvent(runDir, ctx, step.id, eventType, {
      phase: 'afterStep',
      guardrailIndex: k,
      attempt,
      ...(guardrail.name !== undefined
        ? { guardrailName: guardrail.name }
        : {}),
      verdict: resolvedVerdict,
    })
    return resolvedVerdict
  }

  if (resolution.action === 'retry') {
    handleRetryResolution(params, k, resolution, verdict)
  }

  throwMaxRetriesExceeded(params, k, guardrail, verdict)
}

export async function handleGuardrailEscalation(
  params: RunAfterStepGuardrailsParams,
  k: number,
  guardrail: Guardrail<any, any>,
  verdict: GuardrailVerdict,
): Promise<GuardrailVerdict> {
  const { gateWaiter, step } = params
  const policy = determineEscalationPolicy(guardrail, step)

  if (policy !== 'prompt_user') {
    throwMaxRetriesExceeded(params, k, guardrail, verdict)
  }

  if (!gateWaiter) {
    throw new Error('GateWaiter is required for onMaxRetriesExceeded: prompt_user')
  }

  const isRehydratedEscalation = params.rehydratedGate?.guardrailIndex === k
    && params.rehydratedGate.gateType === 'max_retries_exceeded'
  const prompt = isRehydratedEscalation
    ? params.rehydratedGate!.prompt
    : formatEscalationPrompt(step.id, k, verdict)
  const activeGate = recordEscalationActiveGate(params, k, prompt, verdict.logKey)
  return handleEscalationResolution(params, k, guardrail, verdict, activeGate)
}
