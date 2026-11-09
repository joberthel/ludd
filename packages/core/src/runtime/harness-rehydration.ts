import type { StepContext, StepResult } from '../types/context.js'
import type { StepConfig } from '../types/harness.js'
import type { RunStateSnapshot } from '../types/state.js'
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
}

function resolvePreviousRehydration(
  previous: RunStateSnapshot,
  activeStepId: string | null,
): RehydrationInfo | undefined {
  const prevSession = previous.activeSessionId
  const hasValidSession = typeof prevSession === 'string' && prevSession.trim() !== ''
  const isMatchingStep = activeStepId !== null && (previous.activeStepId ?? activeStepId) === activeStepId
  const hasRehydrationData = hasValidSession || typeof previous.activeMatrixIndex === 'number'

  if (isMatchingStep && hasRehydrationData) {
    return {
      stepId: activeStepId,
      sessionId: hasValidSession ? prevSession : undefined,
      attempt: previous.activeStepAttempt ?? 1,
      matrixIndex: previous.activeMatrixIndex ?? null,
      matrixOutputs: previous.activeMatrixOutputs ?? [],
    }
  }
}

export function initOrRehydrateSnapshot(
  runDir: string,
  runId: string,
  harnessName: string,
  steps: readonly StepConfig[],
  ctx: StepContext<unknown, Record<string, StepResult<unknown>>>,
): { snapshot: RunStateSnapshot, rehydration?: RehydrationInfo } {
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

  const snapshot: RunStateSnapshot = {
    schemaVersion: 1,
    runId,
    harnessName,
    status: 'running',
    activeStepId,
    activeSessionId: null,
    activeStepAttempt: 1,
    activeMatrixIndex: null,
    activeMatrixOutputs: [],
    activeGuardrailRetries: isRehydrating ? previous?.activeGuardrailRetries : undefined,
    steps: ctx.steps,
    updatedAt: new Date().toISOString(),
  }
  writeRunStateAtomic(runDir, snapshot)
  appendLedgerEvent(runDir, {
    schemaVersion: 1,
    timestamp: new Date().toISOString(),
    runId,
    stepId: null,
    eventType: isRehydrating ? 'run.resumed' : 'run.started',
    payload: { harnessName },
  })
  return { snapshot, rehydration }
}
