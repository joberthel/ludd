import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { isProcessAlive, resolveRunDir, RUNNER_PID_FILE } from '@ludd/core'

export interface SpawnDetachedRunnerOptions {
  configPath: string
  runId: string
  workspaceDir: string
  timeoutMs?: number
}

export async function spawnDetachedRunner(options: SpawnDetachedRunnerOptions): Promise<number> {
  const runDir = resolveRunDir(options.workspaceDir, options.runId)
  const entrypoint = process.argv[1]
  if (!entrypoint)
    throw new Error('Unable to locate the ludd CLI entrypoint for detached execution.')
  const child = spawn(process.execPath, [
    path.resolve(entrypoint),
    '__worker',
    '--config',
    path.resolve(options.configPath),
    '--run-id',
    options.runId,
    '--workspace',
    path.resolve(options.workspaceDir),
  ], { detached: true, stdio: 'ignore' })
  child.unref()

  const deadline = Date.now() + (options.timeoutMs ?? 5000)
  let pid: number | undefined
  while (Date.now() < deadline) {
    if (child.pid !== undefined && fs.existsSync(path.join(runDir, RUNNER_PID_FILE)) && fs.existsSync(path.join(runDir, 'state.json'))) {
      const storedPid = Number.parseInt(fs.readFileSync(path.join(runDir, RUNNER_PID_FILE), 'utf8').trim(), 10)
      if (storedPid === child.pid) {
        pid = storedPid
        break
      }
    }
    await new Promise(resolve => setTimeout(resolve, 50))
    if (child.exitCode !== null && child.exitCode !== 0)
      break
  }
  if (pid === undefined || !isProcessAlive(pid))
    throw new Error(`Detached worker for run ${options.runId} failed to initialize within 5 seconds.`)
  console.log(`Started detached run ${options.runId} (pid: ${pid}, config: ${path.resolve(options.configPath)})`)
  return 0
}
