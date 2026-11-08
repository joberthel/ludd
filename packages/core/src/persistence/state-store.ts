import type { RunStateSnapshot } from '../types/state.js'
import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { SchemaVersionMismatchError } from '../errors/schema-version-mismatch-error.js'

export const SUPPORTED_SCHEMA_VERSION = 1 as const

const stepResultSchema = z.object({
  status: z.enum(['passed', 'failed', 'skipped']),
  output: z.unknown().optional(),
})

export const runStateSnapshotSchema = z.object({
  schemaVersion: z.literal(SUPPORTED_SCHEMA_VERSION),
  runId: z.string(),
  harnessName: z.string(),
  status: z.enum(['running', 'passed', 'failed']),
  activeStepId: z.string().nullable(),
  steps: z.record(z.string(), stepResultSchema),
  updatedAt: z.string(),
})

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

export function readRunState(runDir: string): RunStateSnapshot {
  const statePath = path.join(runDir, 'state.json')
  const content = fs.readFileSync(statePath, 'utf-8')
  const parsed = JSON.parse(content) as unknown

  if (
    typeof parsed !== 'object'
    || parsed === null
    || (parsed as Record<string, unknown>).schemaVersion !== SUPPORTED_SCHEMA_VERSION
  ) {
    const actualVersion = typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>).schemaVersion
      : undefined
    throw new SchemaVersionMismatchError(SUPPORTED_SCHEMA_VERSION, actualVersion, statePath)
  }

  return runStateSnapshotSchema.parse(parsed)
}
