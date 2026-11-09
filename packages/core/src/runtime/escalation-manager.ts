import type { Guardrail, GuardrailVerdict, OnMaxRetriesExceededAction } from '../types/guardrail.js'
import type { StepConfig } from '../types/harness.js'
import type { GateResolveParams } from '../types/ipc.js'
import type { ActiveGateState } from '../types/state.js'
import type { RunAfterStepGuardrailsParams } from './guardrail-executor.js'
import { GuardrailMaxRetriesExceededError } from '../errors/guardrail-max-retries-exceeded-error.js'
import { MaxTotalTurnsExceededError } from '../errors/max-total-turns-exceeded-error.js'
import { writeRunStateAtomic } from '../persistence/state-store.js'
import { emitGuardrailEvent } from './guardrail-executor.js'

export type EscalationReason = 'guardrail_max_retries' | 'max_total_turns'

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
  reason: EscalationReason,
): string {
  const reasonText = reason === 'guardrail_max_retries'
    ? `Guardrail #${guardrailIndex} in step "${stepId}" exceeded maxRetries.`
    : `Step "${stepId}" exceeded maxTotalTurns at guardrail #${guardrailIndex}.`
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

function recordEscalationActiveGate(
  params: RunAfterStepGuardrailsParams,
  guardrailIndex: number,
  prompt: string,
): ActiveGateState {
  const { step, ctx, runDir, snapshot } = params
  const activeGate: ActiveGateState = {
    stepId: step.id,
    ...(ctx.matrix?.index !== undefined
      ? { matrixIndex: ctx.matrix.index }
      : {}),
    phase: 'afterStep',
    guardrailIndex,
    gateType: 'max_retries_exceeded',
    prompt,
    createdAt: new Date().toISOString(),
  }

  snapshot.status = 'waiting_for_gate'
  snapshot.activeGate = activeGate
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

async function handleEscalationResolution(
  params: RunAfterStepGuardrailsParams,
  k: number,
  guardrail: Guardrail<any, any>,
  verdict: GuardrailVerdict,
  reason: EscalationReason,
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
      verdict: resolvedVerdict,
    })
    return resolvedVerdict
  }

  if (reason === 'guardrail_max_retries') {
    throw new GuardrailMaxRetriesExceededError(step.id, k, guardrail.maxRetries ?? 0, verdict)
  }
  throw new MaxTotalTurnsExceededError(step.id, params.maxTotalTurns)
}

export async function handleGuardrailEscalation(
  params: RunAfterStepGuardrailsParams,
  k: number,
  guardrail: Guardrail<any, any>,
  verdict: GuardrailVerdict,
  reason: EscalationReason,
): Promise<GuardrailVerdict> {
  const { gateWaiter, step } = params
  const policy = determineEscalationPolicy(guardrail, step)

  if (policy !== 'prompt_user') {
    if (reason === 'guardrail_max_retries') {
      throw new GuardrailMaxRetriesExceededError(step.id, k, guardrail.maxRetries ?? 0, verdict)
    }
    throw new MaxTotalTurnsExceededError(step.id, params.maxTotalTurns)
  }

  if (!gateWaiter) {
    throw new Error('GateWaiter is required for onMaxRetriesExceeded: prompt_user')
  }

  const prompt = formatEscalationPrompt(step.id, k, verdict, reason)
  const activeGate = recordEscalationActiveGate(params, k, prompt)
  return handleEscalationResolution(params, k, guardrail, verdict, reason, activeGate)
}
