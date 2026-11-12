import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { createControlClient, isProcessAlive, resolveRunDir, RUNNER_PID_FILE, teardownRun } from '@ludd/core'

export interface TeardownCommandOptions {
  runId: string
  workspace?: string
  force?: boolean
}

export async function teardownCommand(options: TeardownCommandOptions): Promise<number> {
  const workspaceDir = path.resolve(options.workspace ?? process.cwd())
  const runDir = resolveRunDir(workspaceDir, options.runId)
  const pidPath = path.join(runDir, RUNNER_PID_FILE)
  const pid = fs.existsSync(pidPath)
    ? Number.parseInt(fs.readFileSync(pidPath, 'utf8').trim(), 10)
    : Number.NaN
  if (Number.isInteger(pid) && isProcessAlive(pid)) {
    const client = await createControlClient(runDir)
    try {
      await client.teardown({
        ...(options.force
          ? { force: true }
          : {}),
      })
    }
    finally { await client.close() }
  }
  else {
    await teardownRun(options.runId, {
      workspaceDir,
      ...(options.force
        ? { force: true }
        : {}),
    })
  }
  console.log(`Tore down run ${options.runId}`)
  return 0
}
