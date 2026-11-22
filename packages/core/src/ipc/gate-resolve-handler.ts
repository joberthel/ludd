import type { GateWaiter } from '../runtime/gate-waiter.js'
import type { GateAction, GateResolveParams, GateResolveResult } from '../types/ipc.js'
import type { RunStateSnapshot } from '../types/state.js'
import { JsonRpcResponseError } from '../errors/json-rpc-response-error.js'
import { appendLedgerEvent } from '../persistence/ledger-writer.js'
import { writeRunStateAtomic } from '../persistence/state-store.js'
import { JSON_RPC_INVALID_PARAMS } from '../types/ipc.js'

const VALID_ACTIONS: readonly GateAction[] = [
  'pass',
  'fail',
  'retry',
  'skip',
  'abort',
  'answer',
]

export interface GateResolveHandlerContext {
  runDir: string
  getSnapshot: () => RunStateSnapshot
  gateWaiter: GateWaiter
}

function validateAction(action: unknown): GateAction {
  if (typeof action !== 'string' || !VALID_ACTIONS.includes(action as GateAction)) {
    throw new JsonRpcResponseError(
      JSON_RPC_INVALID_PARAMS,
      `Invalid params: action must be one of ${VALID_ACTIONS.join(', ')}`,
    )
  }
  return action as GateAction
}

function validateOptionalIndices(raw: Record<string, unknown>): {
  guardrailIndex?: number
  addRetries?: number
} {
  const { guardrailIndex, addRetries } = raw
  if (
    guardrailIndex !== undefined
    && (typeof guardrailIndex !== 'number' || !Number.isInteger(guardrailIndex) || guardrailIndex < 0)
  ) {
    throw new JsonRpcResponseError(
      JSON_RPC_INVALID_PARAMS,
      'Invalid params: guardrailIndex must be a non-negative integer',
    )
  }
  if (
    addRetries !== undefined
    && (typeof addRetries !== 'number' || !Number.isInteger(addRetries) || addRetries < 0)
  ) {
    throw new JsonRpcResponseError(
      JSON_RPC_INVALID_PARAMS,
      'Invalid params: addRetries must be a non-negative integer',
    )
  }
  return {
    guardrailIndex,
    addRetries,
  }
}

export function validateGateResolveParams(raw: unknown): GateResolveParams {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new JsonRpcResponseError(JSON_RPC_INVALID_PARAMS, 'Invalid params: expected an object')
  }
  const obj = raw as Record<string, unknown>
  if (typeof obj.stepId !== 'string' || obj.stepId.trim() === '') {
    throw new JsonRpcResponseError(JSON_RPC_INVALID_PARAMS, 'Invalid params: stepId must be a non-empty string')
  }
  if (obj.feedback !== undefined && typeof obj.feedback !== 'string') {
    throw new JsonRpcResponseError(JSON_RPC_INVALID_PARAMS, 'Invalid params: feedback must be a string')
  }

  const action = validateAction(obj.action)
  const { guardrailIndex, addRetries } = validateOptionalIndices(obj)

  return {
    stepId: obj.stepId.trim(),
    action,
    guardrailIndex,
    feedback: obj.feedback,
    addRetries,
    ...(obj.answer !== undefined
      ? { answer: obj.answer }
      : {}),
  }
}

function verifyActiveGate(
  snapshot: RunStateSnapshot,
  params: GateResolveParams,
): NonNullable<RunStateSnapshot['activeGate']> {
  const activeGate = snapshot.activeGate
  if (!activeGate || snapshot.status !== 'waiting_for_gate') {
    throw new JsonRpcResponseError(JSON_RPC_INVALID_PARAMS, 'No active gate awaiting resolution')
  }
  if (activeGate.stepId !== params.stepId) {
    throw new JsonRpcResponseError(
      JSON_RPC_INVALID_PARAMS,
      `Active gate stepId "${activeGate.stepId}" does not match requested "${params.stepId}"`,
    )
  }
  if (params.guardrailIndex !== undefined && activeGate.guardrailIndex !== params.guardrailIndex) {
    throw new JsonRpcResponseError(
      JSON_RPC_INVALID_PARAMS,
      `Active gate guardrailIndex ${activeGate.guardrailIndex} does not match requested ${params.guardrailIndex}`,
    )
  }
  return activeGate
}

export function createGateResolveHandler(
  context: GateResolveHandlerContext,
): (rawParams: unknown) => Promise<GateResolveResult> {
  return async (rawParams: unknown): Promise<GateResolveResult> => {
    const params = validateGateResolveParams(rawParams)
    const snapshot = context.getSnapshot()
    const activeGate = verifyActiveGate(snapshot, params)

    if (activeGate.gateType === 'human_review' && params.action === 'retry') {
      throw new JsonRpcResponseError(
        JSON_RPC_INVALID_PARAMS,
        'Invalid params: action "retry" is not supported for human_review gates',
      )
    }
    if (activeGate.gateType === 'user_question') {
      if (params.action !== 'answer' && params.action !== 'abort') {
        throw new JsonRpcResponseError(
          JSON_RPC_INVALID_PARAMS,
          `Invalid params: action "${params.action}" is not supported for user_question gates`,
        )
      }
      if (params.action === 'answer' && params.answer === undefined) {
        throw new JsonRpcResponseError(
          JSON_RPC_INVALID_PARAMS,
          'Invalid params: answer is required when resolving a user_question gate',
        )
      }
    }

    appendLedgerEvent(context.runDir, {
      schemaVersion: 1,
      timestamp: new Date().toISOString(),
      runId: snapshot.runId,
      stepId: params.stepId,
      matrixIndex: activeGate.matrixIndex,
      eventType: 'gate.resolved',
      payload: {
        stepId: params.stepId,
        guardrailIndex: activeGate.guardrailIndex,
        action: params.action,
        ...(params.feedback !== undefined
          ? { feedback: params.feedback }
          : {}),
        ...(params.addRetries !== undefined
          ? { addRetries: params.addRetries }
          : {}),
        ...(params.answer !== undefined
          ? { answer: params.answer }
          : {}),
      },
    })

    snapshot.activeGate = null
    snapshot.status = 'running'
    snapshot.updatedAt = new Date().toISOString()
    writeRunStateAtomic(context.runDir, snapshot)

    context.gateWaiter.resolve(params)
    return { ok: true }
  }
}
