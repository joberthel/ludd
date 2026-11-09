import type { GateResolveParams } from '../types/ipc.js'
import type { ActiveGateState } from '../types/state.js'

export interface GateWaiter {
  waitForResolution: (gate: ActiveGateState, signal?: AbortSignal) => Promise<GateResolveParams>
  resolve: (resolution: GateResolveParams) => void
  getActiveGate: () => ActiveGateState | null
  abort: (reason?: string) => void
  isWaiting: () => boolean
}

function extractSignalReason(signal: AbortSignal | undefined): string {
  const reason: unknown = signal?.reason
  if (typeof reason === 'string') {
    return reason
  }
  if (reason instanceof Error) {
    return reason.message
  }
  return 'Gate resolution aborted'
}

function checkPreAborted(signal?: AbortSignal, defaultSignal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new Error(extractSignalReason(signal))
  }
  if (defaultSignal?.aborted) {
    throw new Error(extractSignalReason(defaultSignal))
  }
}

function wireSignalAbort(
  signal: AbortSignal | undefined,
  abortFn: (reason?: string) => void,
): void {
  if (!signal) {
    return
  }
  signal.addEventListener('abort', () => {
    abortFn(extractSignalReason(signal))
  }, { once: true })
}

interface WaiterState {
  activeGate: ActiveGateState | null
  pendingResolve: ((resolution: GateResolveParams) => void) | null
  pendingReject: ((error: Error) => void) | null
  bufferedResolution: GateResolveParams | null
}

function abortPending(state: WaiterState, reason?: string): void {
  state.bufferedResolution = null
  if (state.pendingReject === null) {
    return
  }
  const rejectFn = state.pendingReject
  state.activeGate = null
  state.pendingResolve = null
  state.pendingReject = null
  rejectFn(new Error(reason ?? 'Gate resolution aborted'))
}

function resolvePending(state: WaiterState, resolution: GateResolveParams): void {
  if (state.pendingResolve === null) {
    state.bufferedResolution = resolution
    return
  }
  const resolveFn = state.pendingResolve
  state.activeGate = null
  state.pendingResolve = null
  state.pendingReject = null
  resolveFn(resolution)
}

export function createGateWaiter(defaultSignal?: AbortSignal): GateWaiter {
  const state: WaiterState = {
    activeGate: null,
    pendingResolve: null,
    pendingReject: null,
    bufferedResolution: null,
  }
  const abort = (reason?: string): void => {
    abortPending(state, reason)
  }
  wireSignalAbort(defaultSignal, abort)

  return {
    async waitForResolution(gate: ActiveGateState, signal?: AbortSignal): Promise<GateResolveParams> {
      if (state.activeGate !== null) {
        throw new Error(
          `A gate is already waiting for resolution: ${state.activeGate.stepId} (index ${state.activeGate.guardrailIndex})`,
        )
      }
      checkPreAborted(signal, defaultSignal)
      if (state.bufferedResolution !== null) {
        const res = state.bufferedResolution
        state.bufferedResolution = null
        state.activeGate = null
        return res
      }
      state.activeGate = gate
      return new Promise<GateResolveParams>((resolve, reject) => {
        state.pendingResolve = resolve
        state.pendingReject = reject
        wireSignalAbort(signal, abort)
      })
    },

    resolve(resolution: GateResolveParams): void {
      resolvePending(state, resolution)
    },

    abort,
    getActiveGate: () => state.activeGate,
    isWaiting: () => state.activeGate !== null,
  }
}
