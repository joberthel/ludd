import type { RunStateSnapshot } from '../types/state.js'
import fs from 'node:fs'
import path from 'node:path'

export function resolveRunDir(workspaceDir: string, runId: string): string {
  return path.resolve(workspaceDir, '.harness', 'runs', runId)
}

export function writeRunStateAtomic(runDir: string, state: RunStateSnapshot): void {
  fs.mkdirSync(runDir, { recursive: true })
  const tmpPath = path.join(runDir, 'state.json.tmp')
  const targetPath = path.join(runDir, 'state.json')
  const serialized = `${JSON.stringify(state, null, 2)}\n`
  fs.writeFileSync(tmpPath, serialized, 'utf-8')
  fs.renameSync(tmpPath, targetPath)
}
