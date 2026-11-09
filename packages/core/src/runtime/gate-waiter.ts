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

export function createGateWaiter(defaultSignal?: AbortSignal): GateWaiter {
  let activeGate: ActiveGateState | null = null
  let pendingResolve: ((resolution: GateResolveParams) => void) | null = null
  let pendingReject: ((error: Error) => void) | null = null

  const abort = (reason?: string): void => {
    if (pendingReject === null) {
      return
    }
    const rejectFn = pendingReject
    activeGate = null
    pendingResolve = null
    pendingReject = null
    rejectFn(new Error(reason ?? 'Gate resolution aborted'))
  }

  wireSignalAbort(defaultSignal, abort)

  const waiter: GateWaiter = {
    async waitForResolution(gate: ActiveGateState, signal?: AbortSignal): Promise<GateResolveParams> {
      if (activeGate !== null) {
        throw new Error(
          `A gate is already waiting for resolution: ${activeGate.stepId} (index ${activeGate.guardrailIndex})`,
        )
      }
      checkPreAborted(signal, defaultSignal)

      activeGate = gate
      return new Promise<GateResolveParams>((resolve, reject) => {
        pendingResolve = resolve
        pendingReject = reject
        wireSignalAbort(signal, abort)
      })
    },

    resolve(resolution: GateResolveParams): void {
      if (pendingResolve === null) {
        return
      }
      const resolveFn = pendingResolve
      activeGate = null
      pendingResolve = null
      pendingReject = null
      resolveFn(resolution)
    },

    abort,

    getActiveGate(): ActiveGateState | null {
      return activeGate
    },

    isWaiting(): boolean {
      return activeGate !== null
    },
  }

  return waiter
}
