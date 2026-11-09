import type { ArtifactClient } from '../types/artifact.js'
import type { StepContext, StepResult } from '../types/context.js'
import type { HarnessRunResult } from '../types/harness.js'
import type { LedgerEventType } from '../types/ledger.js'
import type { LogStore } from '../types/log.js'
import type { RunStateSnapshot } from '../types/state.js'
import { createArtifactStore } from '../mcp/artifact-store.js'
import { createLogStore } from '../mcp/log-store.js'
import { appendLedgerEvent } from '../persistence/ledger-writer.js'
import { writeRunStateAtomic } from '../persistence/state-store.js'

export function resolveOption(value: string | undefined, fallback: () => string): string {
  const trimmed = value?.trim()
  return (trimmed !== undefined && trimmed.length > 0)
    ? trimmed
    : fallback()
}

export function createInitialContext(
  runId: string,
  runDir: string,
  artifacts: ArtifactClient = createArtifactStore(runDir),
): StepContext<unknown, Record<string, StepResult<unknown>>> {
  return {
    runId,
    environments: {},
    steps: {},
    step: { id: '', output: undefined, attempt: 1 },
    matrix: undefined,
    artifacts,
  }
}

export function persistSnapshot(runDir: string, snapshot: RunStateSnapshot): void {
  snapshot.updatedAt = new Date().toISOString()
  writeRunStateAtomic(runDir, snapshot)
}

export function clearActiveAndPersist(runDir: string, snapshot: RunStateSnapshot): void {
  snapshot.activeStepId = null
  snapshot.activeSessionId = null
  snapshot.activeStepAttempt = 1
  snapshot.activeMatrixIndex = null
  snapshot.activeMatrixOutputs = []
  snapshot.activeGuardrailRetries = undefined
  persistSnapshot(runDir, snapshot)
}

export function emitLedgerEvent(
  runDir: string,
  runId: string,
  stepId: string | null,
  eventType: LedgerEventType,
  payload: Record<string, unknown>,
  matrixIndex?: number,
): void {
  appendLedgerEvent(runDir, {
    schemaVersion: 1,
    timestamp: new Date().toISOString(),
    runId,
    stepId,
    matrixIndex,
    eventType,
    payload,
  })
}

export function handleStepFailure(
  runDir: string,
  snapshot: RunStateSnapshot,
  stepId: string,
  error: unknown,
  matrixIndex?: number,
): HarnessRunResult {
  const errorMessage = (error as { message?: string } | null)?.message ?? String(error)
  emitLedgerEvent(runDir, snapshot.runId, stepId, 'step.failed', { error: errorMessage }, matrixIndex)
  emitLedgerEvent(runDir, snapshot.runId, null, 'run.failed', { failedStepId: stepId, error: errorMessage })
  snapshot.steps[stepId] = { status: 'failed', output: undefined }
  snapshot.status = 'failed'
  snapshot.activeStepId = null
  persistSnapshot(runDir, snapshot)
  return {
    runId: snapshot.runId,
    status: 'failed',
    steps: snapshot.steps,
    failedStepId: stepId,
    error,
  }
}

export function recordStepResult(
  runDir: string,
  snapshot: RunStateSnapshot,
  stepId: string,
  ctx: StepContext<unknown, Record<string, StepResult<unknown>>>,
  status: 'passed' | 'skipped',
  output?: unknown,
): void {
  ctx.step = { id: stepId, output, attempt: ctx.step.attempt }
  ctx.steps[stepId] = { status, output }
  clearActiveAndPersist(runDir, snapshot)
  emitLedgerEvent(runDir, snapshot.runId, stepId, `step.${status}`, status === 'passed'
    ? { output }
    : {})
}

export function setupHarnessStores(
  runDir: string,
  snapshot: RunStateSnapshot,
): { artifactStore: ArtifactClient, logStore: LogStore } {
  const artifactStore = createArtifactStore(runDir, {
    onArtifactPut: (key) => {
      const items = snapshot.artifacts ?? []
      if (!items.includes(key)) {
        snapshot.artifacts = [...items, key]
        persistSnapshot(runDir, snapshot)
      }
    },
  })
  const logStore = createLogStore(runDir, {
    onLogPersisted: (key, meta) => {
      snapshot.logs = { ...snapshot.logs, [key]: meta }
      persistSnapshot(runDir, snapshot)
    },
  })
  return { artifactStore, logStore }
}
