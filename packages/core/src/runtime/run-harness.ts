import type { EmbeddedMcpServer } from '../types/artifact.js'
import type { StepContext, StepResult } from '../types/context.js'
import type { ProvisionedEnvironment } from '../types/environment.js'
import type { HarnessConfig, HarnessRunResult, RunHarnessOptions, StepConfig } from '../types/harness.js'
import type { ControlServer } from '../types/ipc.js'
import type { LogStore } from '../types/log.js'
import type { RunStateSnapshot } from '../types/state.js'
import type { RehydratedAgentState } from './agent-executor.js'
import type { RehydrationInfo } from './harness-rehydration.js'
import { randomUUID } from 'node:crypto'
import process from 'node:process'
import { validateHarnessConfig } from '../define-harness.js'
import { EnvironmentUnreachableError } from '../errors/environment-unreachable-error.js'
import { startControlServer } from '../ipc/control-server.js'
import { startEmbeddedMcpServer } from '../mcp/mcp-server.js'
import { acquireRunPidLock } from '../persistence/pid-lock.js'
import { readRunState, resolveRunDir } from '../persistence/state-store.js'
import {
  rehydrateEnvironmentsAndCheckHealth,
  resolveStepEnvironment,
} from './environment-manager.js'
import { initOrRehydrateSnapshot } from './harness-rehydration.js'
import { executeMatrixStep, executeSingleSlice } from './matrix-executor.js'
import {
  cleanupRunResources,
  completeSuccessfulRun,
  createInitialContext,
  emitLedgerEvent,
  handleStepFailure,
  persistSnapshot,
  recordStepResult,
  resolveOption,
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
): Promise<unknown> {
  return step.matrix !== undefined
    ? executeMatrixStep(step, step.matrix, ctx, snapshot, runDir, rehydration, mcpServer, environment, logStore)
    : executeSingleSlice(step, ctx, snapshot, runDir, rehydration, mcpServer, environment, logStore)
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

    const stepEnv = await resolveStepEnvironment(step, ctx, workspaceDir, snapshot, runDir)
    emitLedgerEvent(runDir, snapshot.runId, stepId, 'step.started', { attempt })
    const output = await executeStep(step, ctx, snapshot, runDir, rehydration, mcpServer, stepEnv, logStore)
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
): Promise<HarnessRunResult | null> {
  for (const step of steps) {
    if (ctx.steps[step.id]?.status === 'passed' || ctx.steps[step.id]?.status === 'skipped') {
      continue
    }
    const stepRehydration = rehydration?.stepId === step.id
      ? rehydration
      : undefined
    const failure = await runStep(step, ctx, snapshot, runDir, workspaceDir, stepRehydration, mcpServer, logStore)
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

function handleRunError(error: unknown, runDir: string, runId: string, snapshot?: RunStateSnapshot): void {
  if (error instanceof EnvironmentUnreachableError) {
    emitLedgerEvent(runDir, runId, null, 'run.failed', {
      error: error.message,
      envId: error.envId,
      workingDir: error.workingDir,
    })
    const state = snapshot ?? readRunState(runDir)
    state.status = 'failed'
    persistSnapshot(runDir, state)
  }
}

function resolveAndLockRunDir(options?: RunHarnessOptions): { runId: string, workspaceDir: string, runDir: string } {
  const runId = resolveOption(options?.runId, randomUUID)
  const workspaceDir = resolveOption(options?.workspaceDir, () => process.cwd())
  const runDir = resolveRunDir(workspaceDir, runId)
  acquireRunPidLock(runDir, runId)
  return { runId, workspaceDir, runDir }
}

export async function runHarness(
  config: HarnessConfig,
  options?: RunHarnessOptions,
): Promise<HarnessRunResult> {
  const validatedConfig = validateHarnessConfig(config)
  const { runId, workspaceDir, runDir } = resolveAndLockRunDir(options)
  let mcpServer: EmbeddedMcpServer | undefined
  let controlServer: ControlServer | undefined
  let snapshot: RunStateSnapshot | undefined

  try {
    const prepared = await prepareRunContext(validatedConfig, runDir, runId, workspaceDir)
    mcpServer = prepared.mcpServer
    snapshot = prepared.snapshot
    controlServer = await startControlServer(runDir, {
      getStatus: () => snapshot!,
    })

    const failure = await executeStepPipeline(
      validatedConfig.steps,
      prepared.ctx,
      snapshot,
      runDir,
      workspaceDir,
      prepared.rehydration,
      mcpServer,
      prepared.logStore,
    )
    if (failure !== null) {
      return failure
    }
    return completeSuccessfulRun(runDir, snapshot, prepared.ctx.steps)
  }
  catch (error: unknown) {
    handleRunError(error, runDir, runId, snapshot)
    throw error
  }
  finally {
    await cleanupRunResources(runDir, controlServer, mcpServer)
  }
}
