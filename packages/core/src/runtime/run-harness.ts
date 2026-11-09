import type { EmbeddedMcpServer } from '../types/artifact.js'
import type { StepContext, StepResult } from '../types/context.js'
import type { ProvisionedEnvironment } from '../types/environment.js'
import type { HarnessConfig, HarnessRunResult, RunHarnessOptions, StepConfig } from '../types/harness.js'
import type { ControlServer } from '../types/ipc.js'
import type { LogStore } from '../types/log.js'
import type { RunStateSnapshot } from '../types/state.js'
import type { RehydratedAgentState } from './agent-executor.js'
import type { GateWaiter } from './gate-waiter.js'
import type { RehydrationInfo } from './harness-rehydration.js'
import { validateHarnessConfig } from '../define-harness.js'
import { startEmbeddedMcpServer } from '../mcp/mcp-server.js'
import {
  rehydrateEnvironmentsAndCheckHealth,
  resolveStepEnvironment,
} from './environment-manager.js'
import { createGateWaiter } from './gate-waiter.js'
import { initOrRehydrateSnapshot } from './harness-rehydration.js'
import { executeMatrixStep, executeSingleSlice } from './matrix-executor.js'
import {
  cleanupRunResources,
  completeSuccessfulRun,
  createInitialContext,
  emitLedgerEvent,
  handleRunError,
  handleStepFailure,
  initControlServer,
  persistSnapshot,
  recordStepResult,
  resolveAndLockRunDir,
  setupHarnessStores,
} from './run-harness-lifecycle.js'

export type { HarnessRunResult, RunHarnessOptions }

async function executeStep(
  step: StepConfig,
  ctx: StepContext<unknown, Record<string, StepResult<unknown>>>,
  snapshot: RunStateSnapshot,
  runDir: string,
  rehydration?: RehydratedAgentState,
  mcpServer?: EmbeddedMcpServer,
  environment?: ProvisionedEnvironment,
  logStore?: LogStore,
  gateWaiter?: GateWaiter,
): Promise<unknown> {
  return step.matrix !== undefined
    ? executeMatrixStep(step, step.matrix, ctx, snapshot, runDir, rehydration, mcpServer, environment, logStore, gateWaiter)
    : executeSingleSlice(step, ctx, snapshot, runDir, rehydration, mcpServer, environment, logStore, gateWaiter)
}

async function runStep(
  step: StepConfig,
  ctx: StepContext<unknown, Record<string, StepResult<unknown>>>,
  snapshot: RunStateSnapshot,
  runDir: string,
  workspaceDir: string,
  rehydration?: RehydrationInfo,
  mcpServer?: EmbeddedMcpServer,
  logStore?: LogStore,
  gateWaiter?: GateWaiter,
  signal?: AbortSignal,
): Promise<HarnessRunResult | null> {
  const stepId = step.id
  const attempt = rehydration?.attempt ?? 1
  ctx.step = { id: stepId, output: rehydration?.activeStepOutput, attempt }
  snapshot.activeStepId = stepId
  persistSnapshot(runDir, snapshot)

  try {
    if (step.if !== undefined && !(await step.if(ctx))) {
      recordStepResult(runDir, snapshot, stepId, ctx, 'skipped')
      return null
    }

    const stepEnv = await resolveStepEnvironment(step, ctx, workspaceDir, snapshot, runDir, signal)
    emitLedgerEvent(runDir, snapshot.runId, stepId, 'step.started', { attempt })
    const output = await executeStep(step, ctx, snapshot, runDir, rehydration, mcpServer, stepEnv, logStore, gateWaiter)
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

async function executeStepPipeline(
  steps: readonly StepConfig[],
  ctx: StepContext<unknown, Record<string, StepResult<unknown>>>,
  snapshot: RunStateSnapshot,
  runDir: string,
  workspaceDir: string,
  rehydration?: RehydrationInfo,
  mcpServer?: EmbeddedMcpServer,
  logStore?: LogStore,
  gateWaiter?: GateWaiter,
  signal?: AbortSignal,
): Promise<HarnessRunResult | null> {
  for (const step of steps) {
    if (signal?.aborted) {
      return null
    }
    if (ctx.steps[step.id]?.status === 'passed' || ctx.steps[step.id]?.status === 'skipped') {
      continue
    }
    const stepRehydration = rehydration?.stepId === step.id
      ? rehydration
      : undefined
    const failure = await runStep(
      step,
      ctx,
      snapshot,
      runDir,
      workspaceDir,
      stepRehydration,
      mcpServer,
      logStore,
      gateWaiter,
      signal,
    )
    if (failure !== null) {
      return failure
    }
  }
  return null
}

interface PreparedRun {
  ctx: StepContext<unknown, Record<string, StepResult<unknown>>>
  snapshot: RunStateSnapshot
  rehydration?: RehydrationInfo
  mcpServer: EmbeddedMcpServer
  logStore: LogStore
}

async function prepareRunContext(
  validatedConfig: HarnessConfig,
  runDir: string,
  runId: string,
  workspaceDir: string,
  signal?: AbortSignal,
): Promise<PreparedRun> {
  const ctx = createInitialContext(runId, runDir)
  const steps = validatedConfig.steps
  const initResult = initOrRehydrateSnapshot(runDir, runId, validatedConfig.name, steps, ctx)
  const snapshot = initResult.snapshot
  if (initResult.previous !== undefined) {
    const activeStep = steps.find(s => !['passed', 'skipped'].includes(ctx.steps[s.id]?.status ?? ''))
    await rehydrateEnvironmentsAndCheckHealth({
      previousEnvironments: initResult.previous.environments,
      ctx,
      activeStep,
      workspaceDir,
      snapshot,
      runDir,
      defaultSignal: signal,
    })
  }
  const { artifactStore, logStore } = setupHarnessStores(runDir, snapshot)
  ctx.artifacts = artifactStore
  const mcpServer = await startEmbeddedMcpServer(runDir, { artifactStore, logStore })
  return {
    ctx,
    snapshot,
    rehydration: initResult.rehydration,
    mcpServer,
    logStore,
  }
}

function wireAbortSignal(abortController: AbortController, signal?: AbortSignal): void {
  if (!signal) {
    return
  }
  if (signal.aborted) {
    abortController.abort(signal.reason)
    return
  }
  signal.addEventListener('abort', () => {
    abortController.abort(signal.reason)
  }, { once: true })
}

function formatAbortedResult(
  snapshot: RunStateSnapshot,
  steps: Record<string, StepResult<unknown>>,
  reason: unknown,
): HarnessRunResult {
  return {
    runId: snapshot.runId,
    status: 'failed',
    steps,
    error: reason,
  }
}

export async function runHarness(
  config: HarnessConfig,
  options?: RunHarnessOptions,
): Promise<HarnessRunResult> {
  const validatedConfig = validateHarnessConfig(config)
  const { runId, workspaceDir, runDir } = resolveAndLockRunDir(options)
  const abortController = new AbortController()
  wireAbortSignal(abortController, options?.signal)
  const gateWaiter = createGateWaiter(abortController.signal)
  let mcpServer: EmbeddedMcpServer | undefined
  let controlServer: ControlServer | undefined
  let snapshot: RunStateSnapshot | undefined

  try {
    const prep = await prepareRunContext(validatedConfig, runDir, runId, workspaceDir, abortController.signal)
    mcpServer = prep.mcpServer
    snapshot = prep.snapshot
    controlServer = await initControlServer(runDir, snapshot, prep.ctx.environments, abortController, gateWaiter)

    const failure = await executeStepPipeline(
      validatedConfig.steps,
      prep.ctx,
      snapshot,
      runDir,
      workspaceDir,
      prep.rehydration,
      mcpServer,
      prep.logStore,
      gateWaiter,
      abortController.signal,
    )
    if (failure !== null) {
      return failure
    }
    if (abortController.signal.aborted) {
      return formatAbortedResult(snapshot, prep.ctx.steps, abortController.signal.reason)
    }
    return completeSuccessfulRun(runDir, snapshot, prep.ctx.steps)
  }
  catch (error: unknown) {
    handleRunError(error, runDir, runId, snapshot)
    throw error
  }
  finally {
    await cleanupRunResources(runDir, controlServer, mcpServer, gateWaiter)
  }
}
