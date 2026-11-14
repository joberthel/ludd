import type { EmbeddedMcpServer } from '../types/artifact.js'
import type { StepContext, StepResult } from '../types/context.js'
import type { HarnessConfig, HarnessRunResult, RunHarnessOptions, StepConfig } from '../types/harness.js'
import type { ControlServer } from '../types/ipc.js'
import type { LogStore } from '../types/log.js'
import type { RunStateSnapshot } from '../types/state.js'
import type { RehydrationInfo } from './harness-rehydration.js'
import path from 'node:path'
import { validateHarnessConfig } from '../define-harness.js'
import { startEmbeddedMcpServer } from '../mcp/mcp-server.js'
import { applyCleanupPolicy } from './cleanup-policy.js'
import { rehydrateEnvironmentsAndCheckHealth } from './environment-manager.js'
import { createGateWaiter } from './gate-waiter.js'
import { initOrRehydrateSnapshot } from './harness-rehydration.js'
import {
  cleanupRunResources,
  completeSuccessfulRun,
  createInitialContext,
  handleRunError,
  initControlServer,
  resolveAndLockRunDir,
  setupHarnessStores,
} from './run-harness-lifecycle.js'
import { executeStepPipeline } from './run-harness-steps.js'

export type { HarnessRunResult, RunHarnessOptions }

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
  configPath: string | undefined,
  signal?: AbortSignal,
): Promise<PreparedRun> {
  const ctx = createInitialContext(runId, runDir)
  const steps = validatedConfig.steps
  const initResult = initOrRehydrateSnapshot(runDir, runId, validatedConfig.name, steps, ctx, configPath)
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
  signal.addEventListener('abort', () => abortController.abort(signal.reason), { once: true })
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

function resolveRunResult(
  failure: HarnessRunResult | null,
  abortController: AbortController,
  snapshot: RunStateSnapshot,
  steps: Record<string, StepResult<unknown>>,
  runDir: string,
): HarnessRunResult {
  return failure ?? (abortController.signal.aborted
    ? formatAbortedResult(snapshot, steps, abortController.signal.reason)
    : completeSuccessfulRun(runDir, snapshot, steps))
}

export async function runHarness(
  config: HarnessConfig,
  options?: RunHarnessOptions,
): Promise<HarnessRunResult>
export async function runHarness(
  config: HarnessConfig<readonly StepConfig<any, any, any, any, any, any, any>[]>,
  options?: RunHarnessOptions,
): Promise<HarnessRunResult>
export async function runHarness(
  config: HarnessConfig<readonly StepConfig<any, any, any, any, any, any, any>[]>,
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
    const configPath = options?.configPath === undefined
      ? undefined
      : path.relative(workspaceDir, path.resolve(workspaceDir, options.configPath))
    const prep = await prepareRunContext(validatedConfig, runDir, runId, workspaceDir, configPath, abortController.signal)
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
    const result = resolveRunResult(failure, abortController, snapshot, prep.ctx.steps, runDir)

    await applyCleanupPolicy(
      validatedConfig.cleanupPolicy,
      result,
      runId,
      workspaceDir,
      prep.ctx.environments,
    )
    return result
  }
  catch (error: unknown) {
    handleRunError(error, runDir, runId, snapshot)
    throw error
  }
  finally {
    await cleanupRunResources(runDir, controlServer, mcpServer, gateWaiter)
  }
}
