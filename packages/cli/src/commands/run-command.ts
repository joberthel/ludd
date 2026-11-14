import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { loadHarnessConfig, resolveRunDir, RunAlreadyExistsError, runHarness } from '@ludd/core'
import { watchForGate } from '../prompts/watch-for-gate.js'
import { LiveRunTailer } from '../tailer/live-run-tailer.js'

export interface RunCommandOptions {
  configPath?: string
  runId?: string
  workspace?: string
  stream?: boolean
  detach?: boolean
  worker?: boolean
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
  if (options.detach && !options.worker) {
    const { spawnDetachedRunner } = await import('../daemon/spawn-detached-runner.js')
    return spawnDetachedRunner({ configPath: absoluteConfig, runId: id, workspaceDir })
  }
  const runDir = resolveRunDir(workspaceDir, id)
  const tailer = new LiveRunTailer(runDir, options.stream ?? false)
  tailer.start()
  let completed = false
  const gateWatcher = watchForGate(runDir, () => completed, options.worker ?? false)
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
