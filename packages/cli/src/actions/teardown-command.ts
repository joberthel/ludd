import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import {
  createControlClient,
  getControlSocketPath,
  isProcessAlive,
  resolveRunDir,
  RUNNER_PID_FILE,
  teardownRun,
} from '@luddjs/core'

export interface TeardownCommandOptions {
  runId: string
  workspace?: string
  configPath?: string
  force?: boolean
}

function isSocketUnreachableError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code
  return code === 'ENOENT' || code === 'ECONNREFUSED'
}

async function tryTeardownViaControlSocket(runDir: string, force?: boolean): Promise<boolean> {
  if (!fs.existsSync(getControlSocketPath(runDir))) {
    return false
  }
  try {
    const client = await createControlClient(runDir)
    try {
      await client.teardown({
        ...(force
          ? { force: true }
          : {}),
      })
      return true
    }
    finally {
      await client.close()
    }
  }
  catch (error: unknown) {
    if (force && isSocketUnreachableError(error)) {
      return false
    }
    throw error
  }
}

export async function teardownCommand(options: TeardownCommandOptions): Promise<number> {
  const workspaceDir = path.resolve(options.workspace ?? process.cwd())
  const runDir = resolveRunDir(workspaceDir, options.runId)
  const pidPath = path.join(runDir, RUNNER_PID_FILE)
  const pid = fs.existsSync(pidPath)
    ? Number.parseInt(fs.readFileSync(pidPath, 'utf8').trim(), 10)
    : Number.NaN

  const toreDownLive = Number.isInteger(pid) && isProcessAlive(pid)
    ? await tryTeardownViaControlSocket(runDir, options.force)
    : false

  if (!toreDownLive) {
    await teardownRun(options.runId, {
      workspaceDir,
      ...(options.configPath !== undefined
        ? { configPath: options.configPath }
        : {}),
      ...(options.force
        ? { force: true }
        : {}),
    })
  }
  console.log(`Tore down run ${options.runId}`)
  return 0
}
