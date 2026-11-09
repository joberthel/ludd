import type { DynamicProperty, StepContext } from '../types/context.js'
import type { Guardrail, GuardrailVerdict } from '../types/guardrail.js'
import type { GateResolveParams } from '../types/ipc.js'
import type { ActiveGateState } from '../types/state.js'
import type { RunAfterStepGuardrailsParams } from './guardrail-executor.js'
import { writeRunStateAtomic } from '../persistence/state-store.js'
import { resolveDynamicProperty } from '../utils/resolve-dynamic-property.js'
import { emitGuardrailEvent } from './guardrail-executor.js'

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
  params: RunAfterStepGuardrailsParams,
  guardrailIndex: number,
  prompt: string,
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
    gateType: 'human_review',
    prompt,
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
    gateType: 'human_review',
    prompt,
  })

  return activeGate
}

export async function executeHumanReviewAfterStepGuardrail(
  params: RunAfterStepGuardrailsParams,
  guardrail: Guardrail<any, any>,
  k: number,
): Promise<GuardrailVerdict> {
  const { ctx, gateWaiter } = params
  if (!gateWaiter) {
    throw new Error('GateWaiter is required to execute human_review guardrail')
  }

  const promptProp = (guardrail as { prompt?: DynamicProperty<string, StepContext> }).prompt ?? ''
  const resolvedPrompt = await resolveDynamicProperty(promptProp, ctx)
  const activeGate = recordActiveGate(params, k, resolvedPrompt)

  const resolution = await gateWaiter.waitForResolution(activeGate)
  return resolveResolutionVerdict(resolution, resolvedPrompt)
}
