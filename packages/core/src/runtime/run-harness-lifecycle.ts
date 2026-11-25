import type { RunControlHandlerContext } from '../ipc/run-control-handlers.js'
import type { ArtifactClient, EmbeddedMcpServer } from '../types/artifact.js'
import type { StepContext, StepResult } from '../types/context.js'
import type { ProvisionedEnvironment } from '../types/environment.js'
import type { HarnessConfig, HarnessRunResult, RunHarnessOptions, RunLifecycleContext } from '../types/harness.js'
import type { ControlServer } from '../types/ipc.js'
import type { LedgerEventType } from '../types/ledger.js'
import type { LogStore } from '../types/log.js'
import type { RunStateSnapshot } from '../types/state.js'
import type { ResolvedExecutionContext } from './execution-context.js'
import type { GateWaiter } from './gate-waiter.js'
import { randomUUID } from 'node:crypto'
import process from 'node:process'
import { EnvironmentUnreachableError } from '../errors/environment-unreachable-error.js'
import { startControlServer } from '../ipc/control-server.js'
import { createGateResolveHandler } from '../ipc/gate-resolve-handler.js'
import { createRunAbortHandler, createRunTeardownHandler } from '../ipc/run-control-handlers.js'
import { createArtifactStore } from '../mcp/artifact-store.js'
import { createLogStore } from '../mcp/log-store.js'
import { appendLedgerEvent } from '../persistence/ledger-writer.js'
import { acquireRunPidLock, releaseRunPidLock } from '../persistence/pid-lock.js'
import { readRunState, resolveRunDir, writeRunStateAtomic } from '../persistence/state-store.js'
import { executeWithHarnessLifecycle } from './execution-context.js'

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
  snapshot.activeGate = null
  snapshot.activeStepOutput = undefined
  snapshot.activeBeforeStepResults = undefined
  snapshot.activeInteractiveAnswers = undefined
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

function formatErrorMessage(error: unknown): string {
  return (error as { message?: string } | null)?.message ?? String(error)
}

export function handleStepFailure(
  runDir: string,
  snapshot: RunStateSnapshot,
  stepId: string,
  error: unknown,
  matrixIndex?: number,
): HarnessRunResult {
  const errorMessage = formatErrorMessage(error)
  emitLedgerEvent(runDir, snapshot.runId, stepId, 'step.failed', { error: errorMessage }, matrixIndex)
  if (snapshot.status !== 'failed') {
    emitLedgerEvent(runDir, snapshot.runId, null, 'run.failed', { failedStepId: stepId, error: errorMessage })
    snapshot.status = 'failed'
  }
  snapshot.steps[stepId] = { status: 'failed', output: undefined }
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

export function completeSuccessfulRun(
  runDir: string,
  snapshot: RunStateSnapshot,
  steps: Record<string, StepResult<unknown>>,
): HarnessRunResult {
  snapshot.status = 'passed'
  clearActiveAndPersist(runDir, snapshot)
  emitLedgerEvent(runDir, snapshot.runId, null, 'run.passed', {})
  return { runId: snapshot.runId, status: 'passed', steps }
}

export async function cleanupRunResources(
  runDir: string,
  controlServer?: ControlServer,
  mcpServer?: EmbeddedMcpServer,
  gateWaiter?: GateWaiter,
): Promise<void> {
  try {
    gateWaiter?.abort('Run execution terminated')
    await controlServer?.close()
  }
  finally {
    try {
      await mcpServer?.close()
    }
    finally {
      releaseRunPidLock(runDir)
    }
  }
}

export function handleRunError(error: unknown, runDir: string, runId: string, snapshot?: RunStateSnapshot): void {
  if (error instanceof EnvironmentUnreachableError) {
    emitLedgerEvent(runDir, runId, null, 'run.failed', {
      error: error.message,
      envId: error.envId,
      workingDir: error.workingDir,
    })
    const state = snapshot ?? readRunState(runDir)
    state.status = 'failed'
    persistSnapshot(runDir, state)
    return
  }
  if (snapshot !== undefined && snapshot.status !== 'failed') {
    emitLedgerEvent(runDir, runId, null, 'run.failed', {
      error: formatErrorMessage(error),
    })
    snapshot.status = 'failed'
    persistSnapshot(runDir, snapshot)
  }
}

export function formatAbortedResult(
  runDir: string,
  snapshot: RunStateSnapshot,
  steps: Record<string, StepResult<unknown>>,
  reason: unknown,
): HarnessRunResult {
  if (snapshot.status !== 'failed') {
    emitLedgerEvent(runDir, snapshot.runId, null, 'run.failed', {
      error: formatErrorMessage(reason),
      aborted: true,
    })
    snapshot.status = 'failed'
    persistSnapshot(runDir, snapshot)
  }
  return {
    runId: snapshot.runId,
    status: 'failed',
    steps,
    error: reason,
  }
}

export interface ExecuteHarnessLifecycleParams {
  config: HarnessConfig
  lifecycleCtx: RunLifecycleContext
  snapshot: RunStateSnapshot
  steps: Record<string, StepResult<unknown>>
  runDir: string
  abortController: AbortController
  run: (executionContext: ResolvedExecutionContext) => Promise<HarnessRunResult | null>
}

export async function executeHarnessLifecycle(
  params: ExecuteHarnessLifecycleParams,
): Promise<HarnessRunResult> {
  const { config, lifecycleCtx, snapshot, steps, runDir, abortController, run } = params
  let stepFailure: HarnessRunResult | null = null

  try {
    stepFailure = await executeWithHarnessLifecycle({
      config,
      lifecycleCtx,
      run: async (executionContext) => {
        stepFailure = await run(executionContext)
        return stepFailure
      },
    })
  }
  catch (error: unknown) {
    if (stepFailure !== null) {
      return stepFailure
    }
    if (abortController.signal.aborted) {
      return formatAbortedResult(runDir, snapshot, steps, abortController.signal.reason)
    }
    throw error
  }

  if (stepFailure !== null) {
    return stepFailure
  }
  if (abortController.signal.aborted) {
    return formatAbortedResult(runDir, snapshot, steps, abortController.signal.reason)
  }
  return { runId: snapshot.runId, status: 'passed', steps }
}

export function resolveAndLockRunDir(
  options?: RunHarnessOptions,
): { runId: string, workspaceDir: string, runDir: string } {
  const runId = resolveOption(options?.runId, randomUUID)
  const workspaceDir = resolveOption(options?.workspaceDir, () => process.cwd())
  const runDir = resolveRunDir(workspaceDir, runId)
  acquireRunPidLock(runDir, runId)
  return { runId, workspaceDir, runDir }
}

export async function initControlServer(
  runDir: string,
  snapshot: RunStateSnapshot,
  environments: Record<string, ProvisionedEnvironment>,
  abortController: AbortController,
  gateWaiter: GateWaiter,
  onTeardown?: () => boolean | Promise<boolean>,
): Promise<ControlServer> {
  const controlCtx: RunControlHandlerContext = {
    runDir,
    getSnapshot: () => snapshot,
    getEnvironments: () => environments,
    ...(onTeardown !== undefined
      ? { onTeardown }
      : {}),
    abortController,
    gateWaiter,
  }
  return startControlServer(runDir, {
    getStatus: () => snapshot,
    resolveGate: createGateResolveHandler({
      runDir,
      getSnapshot: () => snapshot,
      gateWaiter,
    }),
    abort: createRunAbortHandler(controlCtx),
    teardown: createRunTeardownHandler(controlCtx),
  })
}
