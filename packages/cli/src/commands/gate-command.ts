import type { GateAction } from '@ludd/core'
import path from 'node:path'
import process from 'node:process'
import { createControlClient } from '@ludd/core'
import { promptForGate } from '../prompts/inline-gate-prompter.js'

export interface GateCommandOptions {
  runId: string
  workspace?: string
  action?: GateAction
  feedback?: string
  addRetries?: number
}

export async function gateCommand(options: GateCommandOptions): Promise<number> {
  const runDir = path.join(path.resolve(options.workspace ?? process.cwd()), '.harness', 'runs', options.runId)
  const client = await createControlClient(runDir)
  try {
    const state = await client.status()
    if (state.status !== 'waiting_for_gate' || !state.activeGate) {
      console.error(`Run ${options.runId} is not currently waiting at a gate`)
      return 1
    }
    if (options.action === undefined) {
      await promptForGate(state, client)
      return 0
    }
    if (options.action === 'fail' && state.activeGate.gateType === 'human_review' && (options.feedback?.trim().length ?? 0) === 0)
      throw new Error('Feedback is required when failing a human review gate.')
    await client.resolveGate({
      stepId: state.activeGate.stepId,
      guardrailIndex: state.activeGate.guardrailIndex,
      action: options.action,
      ...(options.feedback !== undefined
        ? { feedback: options.feedback }
        : {}),
      ...(options.addRetries !== undefined
        ? { addRetries: options.addRetries }
        : {}),
    })
    return 0
  }
  finally { await client.close() }
}
