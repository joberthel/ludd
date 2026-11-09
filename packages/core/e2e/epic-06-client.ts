import type { GateAction, GateResolveParams } from '../src/types/ipc.js'
import type { ActiveGateState } from '../src/types/state.js'
import { createControlClient } from '../src/ipc/control-client.js'

export interface WaitForGateOptions {
  stepId: string
  phase?: 'beforeStep' | 'afterStep'
  gateType?: 'human_review' | 'max_retries_exceeded'
  action: GateAction
  feedback?: string
  addRetries?: number
}

function matchesGate(gate: ActiveGateState, options: WaitForGateOptions): boolean {
  if (gate.stepId !== options.stepId) {
    return false
  }
  if (options.phase !== undefined && gate.phase !== options.phase) {
    return false
  }
  if (options.gateType !== undefined && gate.gateType !== options.gateType) {
    return false
  }
  return true
}

export async function waitForGateAndResolve(
  runDir: string,
  options: WaitForGateOptions,
): Promise<ActiveGateState> {
  for (let i = 0; i < 60; i++) {
    try {
      const client = await createControlClient(runDir)
      const state = await client.status()
      if (state.status === 'waiting_for_gate' && state.activeGate && matchesGate(state.activeGate, options)) {
        const activeGate = state.activeGate
        const resolveParams: GateResolveParams = {
          stepId: activeGate.stepId,
          guardrailIndex: activeGate.guardrailIndex,
          action: options.action,
          feedback: options.feedback,
          addRetries: options.addRetries,
        }
        await client.resolveGate(resolveParams)
        await client.close()
        return activeGate
      }
      await client.close()
    }
    catch {
      // Waiting for control server
    }
    await new Promise(r => setTimeout(r, 50))
  }
  throw new Error(`Timeout waiting for gate in step "${options.stepId}"`)
}

export async function waitForGateCondition(
  runDir: string,
  predicate: (gate: ActiveGateState) => boolean,
): Promise<ActiveGateState> {
  for (let i = 0; i < 60; i++) {
    try {
      const client = await createControlClient(runDir)
      const state = await client.status()
      await client.close()
      if (state.status === 'waiting_for_gate' && state.activeGate && predicate(state.activeGate)) {
        return state.activeGate
      }
    }
    catch {
      // Waiting for control server
    }
    await new Promise(r => setTimeout(r, 50))
  }
  throw new Error('Timeout waiting for gate condition')
}
