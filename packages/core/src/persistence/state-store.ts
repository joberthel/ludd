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

const logMetadataSchema = z.object({
  logKey: z.string(),
  format: z.enum(['text', 'json']),
  filePath: z.string().optional(),
  totalLines: z.number().int().nonnegative().optional(),
  totalItems: z.number().int().nonnegative().optional(),
  propertyKey: z.string().optional(),
  stepId: z.string().optional(),
  attempt: z.number().int().positive().optional(),
  phase: z.enum(['beforeStep', 'afterStep']).optional(),
  guardrailIndex: z.number().int().nonnegative().optional(),
  createdAt: z.string().optional(),
})

const environmentDescriptorSchema = z.object({
  id: z.string(),
  type: z.string(),
  workingDir: z.string(),
  branchName: z.string().optional(),
  containerId: z.string().optional(),
  tornDown: z.boolean().optional(),
  ephemeralPorts: z.record(z.string(), z.number()).optional(),
  injectedEnv: z.record(z.string(), z.string()).optional(),
})

const activeGateStateSchema = z.object({
  stepId: z.string(),
  matrixIndex: z.number().int().nonnegative().optional(),
  phase: z.enum(['beforeStep', 'afterStep']),
  guardrailIndex: z.number().int().nonnegative(),
  gateType: z.enum(['human_review', 'max_retries_exceeded']),
  prompt: z.string(),
  createdAt: z.string(),
})

export const runStateSnapshotSchema = z.object({
  schemaVersion: z.literal(SUPPORTED_SCHEMA_VERSION),
  runId: z.string(),
  harnessName: z.string(),
  workflowName: z.string().optional(),
  configPath: z.string().optional(),
  status: z.enum([
    'running',
    'waiting_for_gate',
    'passed',
    'failed',
  ]),
  activeStepId: z.string().nullable(),
  activeGate: activeGateStateSchema.nullable().optional(),
  activeStepOutput: z.unknown().optional(),
  activeBeforeStepResults: z.unknown().optional(),
  activeSessionId: z.string().nullable().optional(),
  activeStepAttempt: z.number().optional(),
  activeMatrixIndex: z.number().int().nonnegative().nullable().optional(),
  activeMatrixOutputs: z.array(z.unknown()).optional(),
  activeGuardrailRetries: z.record(z.string(), z.number()).optional(),
  grantedExtraRetries: z.record(z.string(), z.number().int().nonnegative()).optional(),
  grantedExtraTurns: z.record(z.string(), z.number().int().nonnegative()).optional(),
  environments: z.record(z.string(), environmentDescriptorSchema).optional(),
  steps: z.record(z.string(), stepResultSchema),
  artifacts: z.array(z.string()).optional(),
  logs: z.record(z.string(), logMetadataSchema).optional(),
  updatedAt: z.string(),
}).transform(snapshot => ({
  ...snapshot,
  workflowName: snapshot.workflowName ?? snapshot.harnessName,
}))

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
