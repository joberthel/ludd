import path from 'node:path'
import process from 'node:process'
import { createControlClient } from '@ludd/core'

export interface AbortCommandOptions {
  runId: string
  workspace?: string
  reason?: string
  teardown?: boolean
}

export async function abortCommand(options: AbortCommandOptions): Promise<number> {
  const runDir = path.join(path.resolve(options.workspace ?? process.cwd()), '.harness', 'runs', options.runId)
  const client = await createControlClient(runDir)
  try {
    await client.abort({
      ...(options.reason !== undefined
        ? { reason: options.reason }
        : {}),
      ...(options.teardown
        ? { teardown: true }
        : {}),
    })
    console.log(`Aborted run ${options.runId}`)
    return 0
  }
  finally { await client.close() }
}
