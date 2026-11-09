import type { EmbeddedMcpServer } from '../types/artifact.js'
import type { StepContext, StepResult } from '../types/context.js'
import type { HarnessConfig, HarnessRunResult, RunHarnessOptions, StepConfig } from '../types/harness.js'
import type { LedgerEventType } from '../types/ledger.js'
import type { RunStateSnapshot } from '../types/state.js'
import type { RehydratedAgentState } from './agent-executor.js'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { validateHarnessConfig } from '../define-harness.js'
import { createArtifactStore } from '../mcp/artifact-store.js'
import { startEmbeddedMcpServer } from '../mcp/mcp-server.js'
import { appendLedgerEvent } from '../persistence/ledger-writer.js'
import { acquireRunPidLock, releaseRunPidLock } from '../persistence/pid-lock.js'
import { readRunState, resolveRunDir, writeRunStateAtomic } from '../persistence/state-store.js'
import { executeMatrixStep, executeSingleSlice } from './matrix-executor.js'

export type { HarnessRunResult, RunHarnessOptions }

interface RehydrationInfo {
  stepId: string
  sessionId?: string
  attempt?: number
  matrixIndex?: number | null
  matrixOutputs?: readonly unknown[]
}

function resolveOption(value: string | undefined, fallback: () => string): string {
  const trimmed = value?.trim()
  if (typeof trimmed === 'string' && trimmed.length > 0) {
    return trimmed
  }
  return fallback()
}

function createInitialContext(runId: string, runDir: string): StepContext<unknown, Record<string, StepResult<unknown>>> {
  return {
    runId,
    environments: {},
    steps: {},
    step: { id: '', output: undefined, attempt: 1 },
    matrix: undefined,
    artifacts: createArtifactStore(runDir),
  }
}

async function executeStep(
  step: StepConfig,
  ctx: StepContext<unknown, Record<string, StepResult<unknown>>>,
  snapshot: RunStateSnapshot,
  runDir: string,
  rehydration?: RehydratedAgentState,
  mcpServer?: EmbeddedMcpServer,
): Promise<unknown> {
  return step.matrix !== undefined
    ? executeMatrixStep(step, step.matrix, ctx, snapshot, runDir, rehydration, mcpServer)
    : executeSingleSlice(step, ctx, snapshot, runDir, rehydration, mcpServer)
}

function clearActiveAndPersist(runDir: string, snapshot: RunStateSnapshot): void {
  snapshot.activeStepId = null
  snapshot.activeSessionId = null
  snapshot.activeStepAttempt = 1
  snapshot.activeMatrixIndex = null
  snapshot.activeMatrixOutputs = []
  persistSnapshot(runDir, snapshot)
}

function persistSnapshot(runDir: string, snapshot: RunStateSnapshot): void {
  snapshot.updatedAt = new Date().toISOString()
  writeRunStateAtomic(runDir, snapshot)
}

function emitLedgerEvent(
  runDir: string,
  runId: string,
  stepId: string | null,
  eventType: LedgerEventType,
  payload: Record<string, unknown>,
  matrixIndex?: number,
): void {
  const timestamp = new Date().toISOString()
  appendLedgerEvent(runDir, {
    schemaVersion: 1,
    timestamp,
    runId,
    stepId,
    matrixIndex,
    eventType,
    payload,
  })
}

function resolvePreviousRehydration(
  previous: RunStateSnapshot,
  activeStepId: string | null,
): RehydrationInfo | undefined {
  const prevSession = previous.activeSessionId
  const hasValidSession = typeof prevSession === 'string' && prevSession.trim() !== ''
  if (activeStepId !== null && (previous.activeStepId ?? activeStepId) === activeStepId && (hasValidSession || typeof previous.activeMatrixIndex === 'number')) {
    return {
      stepId: activeStepId,
      sessionId: hasValidSession ? prevSession : undefined,
      attempt: previous.activeStepAttempt ?? 1,
      matrixIndex: previous.activeMatrixIndex ?? null,
      matrixOutputs: previous.activeMatrixOutputs ?? [],
    }
  }
}

function initOrRehydrateSnapshot(
  runDir: string,
  runId: string,
  harnessName: string,
  steps: readonly StepConfig[],
  ctx: StepContext<unknown, Record<string, StepResult<unknown>>>,
): { snapshot: RunStateSnapshot, rehydration?: RehydrationInfo } {
  const isRehydrating = fs.existsSync(path.join(runDir, 'state.json'))
  let activeStepId: string | null = steps[0].id
  let rehydration: RehydrationInfo | undefined

  if (isRehydrating) {
    const previous = readRunState(runDir)
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
    steps: ctx.steps,
    updatedAt: new Date().toISOString(),
  }
  writeRunStateAtomic(runDir, snapshot)
  emitLedgerEvent(runDir, runId, null, isRehydrating ? 'run.resumed' : 'run.started', { harnessName })
  return { snapshot, rehydration }
}

function handleStepFailure(
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

function recordStepResult(
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
  const payload = status === 'passed'
    ? { output }
    : {}
  emitLedgerEvent(runDir, snapshot.runId, stepId, `step.${status}`, payload)
}

async function runStep(
  step: StepConfig,
  ctx: StepContext<unknown, Record<string, StepResult<unknown>>>,
  snapshot: RunStateSnapshot,
  runDir: string,
  rehydration?: RehydrationInfo,
  mcpServer?: EmbeddedMcpServer,
): Promise<HarnessRunResult | null> {
  const stepId = step.id
  const attempt = rehydration?.attempt ?? 1
  ctx.step = { id: stepId, output: undefined, attempt }
  snapshot.activeStepId = stepId
  persistSnapshot(runDir, snapshot)

  try {
    if (step.if !== undefined && !(await step.if(ctx))) {
      recordStepResult(runDir, snapshot, stepId, ctx, 'skipped')
      return null
    }

    emitLedgerEvent(runDir, snapshot.runId, stepId, 'step.started', { attempt })
    const output = await executeStep(step, ctx, snapshot, runDir, rehydration, mcpServer)
    recordStepResult(runDir, snapshot, stepId, ctx, 'passed', output)
    return null
  }
  catch (error: unknown) {
    return handleStepFailure(runDir, snapshot, stepId, error, ctx.matrix?.index)
  }
  finally {
    ctx.matrix = undefined
  }
}

export async function runHarness(
  config: HarnessConfig,
  options?: RunHarnessOptions,
): Promise<HarnessRunResult> {
  const validatedConfig = validateHarnessConfig(config)
  const runId = resolveOption(options?.runId, randomUUID)
  const workspaceDir = resolveOption(options?.workspaceDir, () => process.cwd())
  const runDir = resolveRunDir(workspaceDir, runId)

  acquireRunPidLock(runDir, runId)
  let mcpServer: EmbeddedMcpServer | undefined

  try {
    mcpServer = await startEmbeddedMcpServer(runDir)
    const ctx = createInitialContext(runId, runDir)
    const steps = validatedConfig.steps
    const { snapshot, rehydration } = initOrRehydrateSnapshot(
      runDir,
      runId,
      validatedConfig.name,
      steps,
      ctx,
    )

    for (const step of steps) {
      if (ctx.steps[step.id]?.status === 'passed' || ctx.steps[step.id]?.status === 'skipped') {
        continue
      }
      const stepRehydration = rehydration?.stepId === step.id
        ? rehydration
        : undefined
      const failure = await runStep(step, ctx, snapshot, runDir, stepRehydration, mcpServer)
      if (failure !== null) {
        return failure
      }
    }

    snapshot.status = 'passed'
    clearActiveAndPersist(runDir, snapshot)
    emitLedgerEvent(runDir, runId, null, 'run.passed', {})

    return { runId, status: 'passed', steps: ctx.steps }
  }
  finally {
    await mcpServer?.close()
    releaseRunPidLock(runDir)
  }
}
