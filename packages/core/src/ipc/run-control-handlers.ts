import type { GateWaiter } from '../runtime/gate-waiter.js'
import type { ProvisionedEnvironment } from '../types/environment.js'
import type { RunAbortParams, RunAbortResult, RunTeardownParams, RunTeardownResult } from '../types/ipc.js'
import type { RunStateSnapshot } from '../types/state.js'
import { JsonRpcResponseError } from '../errors/json-rpc-response-error.js'
import { appendLedgerEvent } from '../persistence/ledger-writer.js'
import { writeRunStateAtomic } from '../persistence/state-store.js'
import { JSON_RPC_INVALID_PARAMS } from '../types/ipc.js'

export interface RunControlHandlerContext {
  runDir: string
  getSnapshot: () => RunStateSnapshot
  getEnvironments: () => Record<string, ProvisionedEnvironment>
  abortController: AbortController
  gateWaiter: GateWaiter
}

export function validateRunAbortParams(raw: unknown): RunAbortParams {
  if (raw !== undefined && (typeof raw !== 'object' || raw === null || Array.isArray(raw))) {
    throw new JsonRpcResponseError(JSON_RPC_INVALID_PARAMS, 'Invalid params: expected an object')
  }
  const obj = (raw ?? {}) as Record<string, unknown>
  if (obj.reason !== undefined && typeof obj.reason !== 'string') {
    throw new JsonRpcResponseError(JSON_RPC_INVALID_PARAMS, 'Invalid params: reason must be a string')
  }
  if (obj.teardown !== undefined && typeof obj.teardown !== 'boolean') {
    throw new JsonRpcResponseError(JSON_RPC_INVALID_PARAMS, 'Invalid params: teardown must be a boolean')
  }
  return {
    reason: obj.reason,
    teardown: obj.teardown,
  }
}

export function validateRunTeardownParams(raw: unknown): RunTeardownParams {
  if (raw !== undefined && (typeof raw !== 'object' || raw === null || Array.isArray(raw))) {
    throw new JsonRpcResponseError(JSON_RPC_INVALID_PARAMS, 'Invalid params: expected an object')
  }
  const obj = (raw ?? {}) as Record<string, unknown>
  if (obj.force !== undefined && typeof obj.force !== 'boolean') {
    throw new JsonRpcResponseError(JSON_RPC_INVALID_PARAMS, 'Invalid params: force must be a boolean')
  }
  return {
    force: obj.force,
  }
}

async function performEnvironmentTeardown(
  runDir: string,
  snapshot: RunStateSnapshot,
  environments: Record<string, ProvisionedEnvironment>,
  extraPayload: Record<string, unknown>,
): Promise<void> {
  const envList = Object.values(environments)
  await Promise.all(envList.map(async env => env.teardown()))
  appendLedgerEvent(runDir, {
    schemaVersion: 1,
    timestamp: new Date().toISOString(),
    runId: snapshot.runId,
    stepId: null,
    eventType: 'run.teardown',
    payload: {
      environments: envList.map(e => e.id),
      ...extraPayload,
    },
  })
  snapshot.environments = {}
}

export function createRunAbortHandler(
  context: RunControlHandlerContext,
): (rawParams?: unknown) => Promise<RunAbortResult> {
  return async (rawParams?: unknown): Promise<RunAbortResult> => {
    const params = validateRunAbortParams(rawParams)
    const reason = params.reason ?? 'Run aborted by external control'
    const snapshot = context.getSnapshot()

    context.gateWaiter.abort(reason)
    context.abortController.abort(new Error(reason))

    appendLedgerEvent(context.runDir, {
      schemaVersion: 1,
      timestamp: new Date().toISOString(),
      runId: snapshot.runId,
      stepId: snapshot.activeStepId,
      eventType: 'run.failed',
      payload: { error: reason, aborted: true },
    })

    snapshot.status = 'failed'
    snapshot.activeGate = null
    snapshot.activeStepId = null

    if (params.teardown) {
      await performEnvironmentTeardown(context.runDir, snapshot, context.getEnvironments(), { aborted: true })
    }

    snapshot.updatedAt = new Date().toISOString()
    writeRunStateAtomic(context.runDir, snapshot)
    return { ok: true }
  }
}

export function createRunTeardownHandler(
  context: RunControlHandlerContext,
): (rawParams?: unknown) => Promise<RunTeardownResult> {
  return async (rawParams?: unknown): Promise<RunTeardownResult> => {
    const params = validateRunTeardownParams(rawParams)
    const snapshot = context.getSnapshot()

    await performEnvironmentTeardown(context.runDir, snapshot, context.getEnvironments(), {
      forced: Boolean(params.force),
    })

    snapshot.updatedAt = new Date().toISOString()
    writeRunStateAtomic(context.runDir, snapshot)
    return { ok: true }
  }
}
