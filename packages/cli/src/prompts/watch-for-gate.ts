import fs from 'node:fs'
import path from 'node:path'
import { createControlClient, readRunState } from '@ludd/core'
import { promptForGate } from './inline-gate-prompter.js'

/**
 * Polls the run state file for an active gate and prompts the user inline
 * until the run completes. No-ops immediately in worker mode.
 */
export async function watchForGate(runDir: string, isCompleted: () => boolean, worker: boolean): Promise<void> {
  if (worker)
    return
  let gateKey = ''
  const stateFile = path.join(runDir, 'state.json')
  while (!isCompleted()) {
    await new Promise(resolve => setTimeout(resolve, 100))
    if (isCompleted())
      break
    if (!fs.existsSync(stateFile))
      continue
    const state = readRunState(runDir)
    const gate = state.activeGate
    if (state.status !== 'waiting_for_gate' || !gate) {
      gateKey = ''
      continue
    }
    const key = `${gate.stepId}:${gate.guardrailIndex}:${gate.createdAt}`
    if (gateKey === key)
      continue
    gateKey = key
    const client = await createControlClient(runDir)
    try {
      await promptForGate(state, client)
    }
    finally {
      await client.close()
    }
  }
}
