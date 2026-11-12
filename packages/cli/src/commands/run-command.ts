import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { createControlClient, loadHarnessConfig, readRunState, resolveRunDir, RunAlreadyExistsError, runHarness } from '@ludd/core'
import { promptForGate } from '../prompts/inline-gate-prompter.js'
import { LiveRunTailer } from '../tailer/live-run-tailer.js'

export interface RunCommandOptions {
  configPath?: string
  runId?: string
  workspace?: string
  stream?: boolean
}

export async function runCommand(options: RunCommandOptions): Promise<number> {
  const workspaceDir = path.resolve(options.workspace ?? process.cwd())
  const configPath = options.configPath ?? 'harness.config.ts'
  const runId = options.runId
  if (runId !== undefined && fs.existsSync(path.join(resolveRunDir(workspaceDir, runId), 'state.json'))) {
    throw new RunAlreadyExistsError(runId)
  }
  const absoluteConfig = path.resolve(workspaceDir, configPath)
  const config = await loadHarnessConfig(absoluteConfig)
  const id = runId ?? randomUUID()
  const runDir = resolveRunDir(workspaceDir, id)
  const tailer = new LiveRunTailer(runDir, options.stream ?? false)
  tailer.start()
  let completed = false
  let gateKey = ''
  const gateWatcher = (async () => {
    while (true) {
      if (completed)
        break
      await new Promise(resolve => setTimeout(resolve, 100))
      if (completed)
        break
      const stateFile = path.join(runDir, 'state.json')
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
  })()
  try {
    const result = await runHarness(config, { runId: id, workspaceDir, configPath })
    return result.status === 'passed'
      ? 0
      : 1
  }
  finally {
    completed = true
    tailer.stop()
    await gateWatcher
  }
}
