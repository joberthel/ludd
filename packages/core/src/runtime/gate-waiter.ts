import type { GateResolveParams } from '../types/ipc.js'
import type { ActiveGateState } from '../types/state.js'

export interface GateWaiter {
  waitForResolution: (gate: ActiveGateState) => Promise<GateResolveParams>
  resolve: (resolution: GateResolveParams) => void
  getActiveGate: () => ActiveGateState | null
  abort: (reason?: string) => void
  isWaiting: () => boolean
}

export function createGateWaiter(): GateWaiter {
  let activeGate: ActiveGateState | null = null
  let pendingResolve: ((resolution: GateResolveParams) => void) | null = null
  let pendingReject: ((error: Error) => void) | null = null

  return {
    async waitForResolution(gate: ActiveGateState): Promise<GateResolveParams> {
      if (activeGate !== null) {
        throw new Error(
          `A gate is already waiting for resolution: ${activeGate.stepId} (index ${activeGate.guardrailIndex})`,
        )
      }
      activeGate = gate
      return new Promise<GateResolveParams>((resolve, reject) => {
        pendingResolve = resolve
        pendingReject = reject
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

    abort(reason?: string): void {
      if (pendingReject === null) {
        return
      }
      const rejectFn = pendingReject
      activeGate = null
      pendingResolve = null
      pendingReject = null
      rejectFn(new Error(reason ?? 'Gate resolution aborted'))
    },

    getActiveGate(): ActiveGateState | null {
      return activeGate
    },

    isWaiting(): boolean {
      return activeGate !== null
    },
  }
}
