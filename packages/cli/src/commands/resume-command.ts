import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { createControlClient, isProcessAlive, loadHarnessConfig, readRunState, resolveRunDir, runHarness, RUNNER_PID_FILE, RunAlreadyActiveError, RunNotFoundError } from '@ludd/core'
import { promptForGate } from '../prompts/inline-gate-prompter.js'
import { LiveRunTailer } from '../tailer/live-run-tailer.js'

export interface ResumeCommandOptions {
  runId: string
  workspace?: string
  stream?: boolean
  configPath?: string
}

async function watchForGate(runDir: string, stateFile: string, isCompleted: () => boolean): Promise<void> {
  let gateKey = ''
  return (async () => {
    while (true) {
      if (isCompleted())
        break
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
  })()
}

export async function resumeCommand(options: ResumeCommandOptions): Promise<number> {
  if (options.configPath !== undefined) {
    throw new Error('The resume command does not accept --config; it uses the configPath persisted with the run.')
  }
  const workspaceDir = path.resolve(options.workspace ?? process.cwd())
  const runDir = resolveRunDir(workspaceDir, options.runId)
  const stateFile = path.join(runDir, 'state.json')
  if (!fs.existsSync(stateFile)) {
    throw new RunNotFoundError(options.runId)
  }

  const state = readRunState(runDir)
  if (state.status === 'passed') {
    console.log(`Run ${options.runId} has already completed (status: passed)`)
    return 0
  }
  const pidFile = path.join(runDir, RUNNER_PID_FILE)
  if (fs.existsSync(pidFile)) {
    const pid = Number.parseInt(fs.readFileSync(pidFile, 'utf-8').trim(), 10)
    if (isProcessAlive(pid)) {
      throw new RunAlreadyActiveError(options.runId, pid)
    }
  }

  const configPath = state.configPath ?? 'harness.config.ts'
  const config = await loadHarnessConfig(path.resolve(workspaceDir, configPath))
  const tailer = new LiveRunTailer(runDir, options.stream ?? false)
  tailer.start()
  let completed = false
  const gateWatcher = watchForGate(runDir, stateFile, () => completed)
  try {
    const result = await runHarness(config, { runId: options.runId, workspaceDir, configPath })
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
