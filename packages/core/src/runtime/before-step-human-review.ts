import type { DynamicProperty, StepContext } from '../types/context.js'
import type { Guardrail, GuardrailVerdict } from '../types/guardrail.js'
import type { GateResolveParams } from '../types/ipc.js'
import type { LedgerEventType } from '../types/ledger.js'
import type { LogStore } from '../types/log.js'
import type { ActiveGateState } from '../types/state.js'
import type { BeforeStepExecutionResult, RunBeforeStepGuardrailsParams } from './before-step-executor.js'
import { writeRunStateAtomic } from '../persistence/state-store.js'
import { resolveDynamicProperty } from '../utils/resolve-dynamic-property.js'
import { emitBeforeStepEvent, offloadBeforeStepLog } from './before-step-executor.js'

function resolveResolutionVerdict(
  resolution: GateResolveParams,
  resolvedPrompt: string,
): GuardrailVerdict {
  if (resolution.action === 'pass') {
    return {
      status: 'pass',
      body: resolution.feedback !== undefined && resolution.feedback.trim() !== ''
        ? resolution.feedback
        : resolvedPrompt,
    }
  }
  if (resolution.action === 'skip') {
    return { status: 'skip', body: resolution.feedback ?? '' }
  }
  if (resolution.action === 'fail') {
    return { status: 'fail', body: resolution.feedback ?? '' }
  }
  throw new Error(
    resolution.feedback !== undefined && resolution.feedback.trim() !== ''
      ? `Gate resolution aborted: ${resolution.feedback}`
      : 'Gate resolution aborted',
  )
}

function recordActiveGate(
  params: RunBeforeStepGuardrailsParams,
  guardrailIndex: number,
  prompt: string,
): ActiveGateState {
  const { step, ctx, runDir, snapshot } = params
  const isMatchingExisting = snapshot.activeGate?.guardrailIndex === guardrailIndex
    && snapshot.activeGate?.phase === 'beforeStep'
  const activeGate: ActiveGateState = {
    stepId: step.id,
    ...(ctx.matrix?.index !== undefined
      ? { matrixIndex: ctx.matrix.index }
      : {}),
    phase: 'beforeStep',
    guardrailIndex,
    gateType: 'human_review',
    prompt,
    createdAt: isMatchingExisting
      ? snapshot.activeGate!.createdAt
      : new Date().toISOString(),
  }

  snapshot.status = 'waiting_for_gate'
  snapshot.activeGate = activeGate
  snapshot.activeStepOutput = undefined
  snapshot.updatedAt = new Date().toISOString()
  writeRunStateAtomic(runDir, snapshot)

  emitBeforeStepEvent(runDir, ctx, step.id, 'gate.waiting', {
    phase: 'beforeStep',
    guardrailIndex,
    gateType: 'human_review',
    prompt,
  })

  return activeGate
}

export async function executeHumanReviewBeforeStepGuardrail(
  params: RunBeforeStepGuardrailsParams,
  guardrail: Guardrail<any, any>,
  k: number,
  logStore: LogStore,
): Promise<BeforeStepExecutionResult> {
  const { step, ctx, runDir, snapshot, gateWaiter } = params
  if (!gateWaiter) {
    throw new Error('GateWaiter is required to execute human_review guardrail')
  }

  const promptProp = (guardrail as { prompt?: DynamicProperty<string, StepContext> }).prompt ?? ''
  const resolvedPrompt = await resolveDynamicProperty(promptProp, ctx)
  const activeGate = recordActiveGate(params, k, resolvedPrompt)

  const resolution = await gateWaiter.waitForResolution(activeGate)
  const verdict = resolveResolutionVerdict(resolution, resolvedPrompt)

  const eventType: LedgerEventType = verdict.status === 'pass'
    ? 'guardrail.passed'
    : verdict.status === 'skip'
      ? 'guardrail.skipped'
      : 'guardrail.failed'

  emitBeforeStepEvent(runDir, ctx, step.id, eventType, {
    phase: 'beforeStep',
    guardrailIndex: k,
    attempt: 1,
    verdict,
  })

  const logKey = await offloadBeforeStepLog(runDir, snapshot, step.id, k, verdict, logStore)
  return {
    guardrailIndex: k,
    verdict,
    logKey,
    feedback: resolution.feedback,
  }
}
