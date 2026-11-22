import path from 'node:path'
import process from 'node:process'
import { gc, parseDurationToMs } from '@ludd/core'

export interface GcCommandOptions {
  runId?: string | string[]
  workspace?: string
  olderThan?: string
  status?: string[]
  dryRun?: boolean
}

export async function gcCommand(options: GcCommandOptions): Promise<number> {
  const result = await gc({
    workspaceDir: path.resolve(options.workspace ?? process.cwd()),
    ...(options.runId !== undefined
      ? { runId: options.runId }
      : {}),
    ...(options.olderThan !== undefined
      ? {
          olderThanMs: parseDurationToMs(options.olderThan),
        }
      : {}),
    ...(options.status !== undefined
      ? { status: options.status as ('running' | 'waiting_for_gate' | 'passed' | 'failed')[] }
      : {}),
    ...(options.dryRun
      ? { dryRun: true }
      : {}),
  })
  console.log(`${options.dryRun ? 'Would clean' : 'Cleaned'} ${result.cleanedRunIds.length} run(s): ${result.cleanedRunIds.join(', ') || 'none'}`)
  console.log(`Skipped active ${result.skippedActiveRunIds.length} run(s): ${result.skippedActiveRunIds.join(', ') || 'none'}`)
  return 0
}
