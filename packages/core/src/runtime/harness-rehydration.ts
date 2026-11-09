import type { StepContext, StepResult } from '../types/context.js'
import type { StepConfig } from '../types/harness.js'
import type { ActiveGateState, RunStateSnapshot } from '../types/state.js'
import fs from 'node:fs'
import path from 'node:path'
import { appendLedgerEvent } from '../persistence/ledger-writer.js'
import { readRunState, writeRunStateAtomic } from '../persistence/state-store.js'

export interface RehydrationInfo {
  stepId: string
  sessionId?: string
  attempt?: number
  matrixIndex?: number | null
  matrixOutputs?: readonly unknown[]
  guardrailRetries?: Record<string, number>
  activeGate?: ActiveGateState | null
  activeStepOutput?: unknown
}

function resolvePreviousRehydration(
  previous: RunStateSnapshot,
  activeStepId: string | null,
): RehydrationInfo | undefined {
  const prevSession = previous.activeSessionId
  const hasValidSession = typeof prevSession === 'string' && prevSession.trim() !== ''
  const isMatchingStep = activeStepId !== null && (previous.activeStepId ?? activeStepId) === activeStepId
  const hasRehydrationData = hasValidSession
    || typeof previous.activeMatrixIndex === 'number'
    || typeof previous.activeStepAttempt === 'number'
    || previous.activeGuardrailRetries !== undefined
    || Boolean(previous.activeGate)
    || previous.status === 'waiting_for_gate'

  const guardrailRetries = previous.activeGuardrailRetries
    ? { ...previous.activeGuardrailRetries }
    : undefined

  if (isMatchingStep && hasRehydrationData) {
    return {
      stepId: activeStepId,
      sessionId: hasValidSession ? prevSession : undefined,
      attempt: previous.activeStepAttempt ?? 1,
      matrixIndex: previous.activeMatrixIndex ?? null,
      matrixOutputs: previous.activeMatrixOutputs ?? [],
      guardrailRetries,
      activeGate: previous.activeGate ?? null,
      activeStepOutput: previous.activeStepOutput,
    }
  }
}

function buildSnapshot(
  runId: string,
  harnessName: string,
  activeStepId: string | null,
  ctxSteps: Record<string, StepResult<unknown>>,
  rehydration?: RehydrationInfo,
  previous?: RunStateSnapshot,
): RunStateSnapshot {
  const matrixOutputs = rehydration?.matrixOutputs
    ? [...rehydration.matrixOutputs]
    : []
  const guardrailRetries = rehydration?.guardrailRetries
    ? { ...rehydration.guardrailRetries }
    : undefined
  const environments = previous?.environments
    ? { ...previous.environments }
    : undefined
  const artifacts = previous?.artifacts
    ? [...previous.artifacts]
    : undefined
  const logs = previous?.logs
    ? { ...previous.logs }
    : undefined
  const isWaiting = Boolean(rehydration?.activeGate) || previous?.status === 'waiting_for_gate'

  return {
    schemaVersion: 1,
    runId,
    harnessName,
    status: isWaiting ? 'waiting_for_gate' : 'running',
    activeStepId,
    activeGate: rehydration?.activeGate ?? null,
    activeStepOutput: rehydration?.activeStepOutput,
    activeSessionId: rehydration?.sessionId ?? null,
    activeStepAttempt: rehydration?.attempt ?? 1,
    activeMatrixIndex: rehydration?.matrixIndex ?? null,
    activeMatrixOutputs: matrixOutputs,
    activeGuardrailRetries: guardrailRetries,
    grantedExtraRetries: previous?.grantedExtraRetries
      ? { ...previous.grantedExtraRetries }
      : undefined,
    grantedExtraTurns: previous?.grantedExtraTurns
      ? { ...previous.grantedExtraTurns }
      : undefined,
    environments,
    steps: ctxSteps,
    artifacts,
    logs,
    updatedAt: new Date().toISOString(),
  }
}

export function initOrRehydrateSnapshot(
  runDir: string,
  runId: string,
  harnessName: string,
  steps: readonly StepConfig[],
  ctx: StepContext<unknown, Record<string, StepResult<unknown>>>,
): {
  snapshot: RunStateSnapshot
  rehydration?: RehydrationInfo
  previous?: RunStateSnapshot
} {
  const isRehydrating = fs.existsSync(path.join(runDir, 'state.json'))
  let activeStepId: string | null = steps[0].id
  let rehydration: RehydrationInfo | undefined
  let previous: RunStateSnapshot | undefined

  if (isRehydrating) {
    previous = readRunState(runDir)
    for (const [id, result] of Object.entries(previous.steps)) {
      if (result.status === 'passed' || result.status === 'skipped') {
        ctx.steps[id] = result
      }
    }
    activeStepId = steps.find(s => !['passed', 'skipped'].includes(ctx.steps[s.id]?.status ?? ''))?.id ?? null
    rehydration = resolvePreviousRehydration(previous, activeStepId)
  }

  const snapshot = buildSnapshot(runId, harnessName, activeStepId, ctx.steps, rehydration, previous)
  writeRunStateAtomic(runDir, snapshot)
  appendLedgerEvent(runDir, {
    schemaVersion: 1,
    timestamp: new Date().toISOString(),
    runId,
    stepId: null,
    eventType: isRehydrating ? 'run.resumed' : 'run.started',
    payload: { harnessName },
  })
  return { snapshot, rehydration, previous }
}
