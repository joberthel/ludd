import type { EmbeddedMcpServer } from '../types/artifact.js'
import type { StepContext, StepResult } from '../types/context.js'
import type { HarnessConfig, HarnessRunResult, RunHarnessOptions, RunLifecycleContext, StepConfig } from '../types/harness.js'
import type { ControlServer } from '../types/ipc.js'
import type { LogStore } from '../types/log.js'
import type { RunStateSnapshot } from '../types/state.js'
import type { RehydrationInfo } from './harness-rehydration.js'
import path from 'node:path'
import { validateHarnessConfig } from '../define-harness.js'
import { startEmbeddedMcpServer } from '../mcp/mcp-server.js'
import { createGateWaiter } from './gate-waiter.js'
import { initOrRehydrateSnapshot } from './harness-rehydration.js'
import {
  cleanupRunResources,
  completeSuccessfulRun,
  createInitialContext,
  executeHarnessLifecycle,
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
  configPath: string | undefined,
): Promise<PreparedRun> {
  const ctx = createInitialContext(runId, runDir)
  const steps = validatedConfig.steps
  const initResult = initOrRehydrateSnapshot(runDir, runId, validatedConfig.name, steps, ctx, configPath)
  const snapshot = initResult.snapshot
  const { artifactStore, logStore } = setupHarnessStores(runDir, snapshot)
  ctx.artifacts = artifactStore
  const mcpServer = await startEmbeddedMcpServer(runDir, {
    artifactStore,
    logStore,
  })
  return {
    ctx,
    snapshot,
    rehydration: initResult.rehydration,
    mcpServer,
    logStore,
  }
}

function noop(): void {}

function wireAbortSignal(abortController: AbortController, signal?: AbortSignal): () => void {
  if (!signal) {
    return noop
  }
  if (signal.aborted) {
    abortController.abort(signal.reason)
    return noop
  }
  const onAbort = (): void => {
    abortController.abort(signal.reason)
  }
  signal.addEventListener('abort', onAbort, { once: true })
  return () => {
    signal.removeEventListener('abort', onAbort)
  }
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
  const detachAbortSignal = wireAbortSignal(abortController, options?.signal)
  const gateWaiter = createGateWaiter(abortController.signal)
  const lifecycleCtx: RunLifecycleContext = {
    runId,
    workspaceRoot: workspaceDir,
    signal: abortController.signal,
  }
  let mcpServer: EmbeddedMcpServer | undefined
  let controlServer: ControlServer | undefined
  let snapshot: RunStateSnapshot | undefined

  try {
    const configPath = options?.configPath === undefined
      ? undefined
      : path.relative(workspaceDir, path.resolve(workspaceDir, options.configPath))
    const prep = await prepareRunContext(validatedConfig, runDir, runId, configPath)
    mcpServer = prep.mcpServer
    snapshot = prep.snapshot
    let teardownCompleted = false
    let teardownInFlight: Promise<boolean> | undefined
    const runTeardownHook = validatedConfig.teardown
      ? async (ctx: RunLifecycleContext): Promise<boolean> => {
        if (teardownCompleted) {
          return false
        }
        if (teardownInFlight !== undefined) {
          return teardownInFlight
        }
        const execution = Promise.resolve()
          .then(async () => validatedConfig.teardown!(ctx))
          .then(() => {
            teardownCompleted = true
            return true
          })
          .finally(() => {
            teardownInFlight = undefined
          })
        teardownInFlight = execution
        return execution
      }
      : undefined
    const effectiveConfig = runTeardownHook
      ? {
          ...validatedConfig,
          teardown: async (ctx: RunLifecycleContext) => {
            await runTeardownHook(ctx)
          },
        }
      : validatedConfig

    controlServer = await initControlServer(
      runDir,
      snapshot,
      abortController,
      gateWaiter,
      runTeardownHook
        ? async () => runTeardownHook({ ...lifecycleCtx, signal: new AbortController().signal })
        : undefined,
    )

    const lifecycleResult = await executeHarnessLifecycle({
      config: effectiveConfig,
      lifecycleCtx,
      snapshot,
      steps: prep.ctx.steps,
      runDir,
      abortController,
      run: async runExecutionContext => executeStepPipeline(
        validatedConfig.steps,
        prep.ctx,
        snapshot!,
        runDir,
        runExecutionContext,
        prep.rehydration,
        mcpServer,
        prep.logStore,
        gateWaiter,
        abortController.signal,
      ),
    })

    return lifecycleResult.status === 'passed'
      ? completeSuccessfulRun(runDir, snapshot, prep.ctx.steps)
      : lifecycleResult
  }
  catch (error: unknown) {
    handleRunError(error, runDir, runId, snapshot)
    throw error
  }
  finally {
    detachAbortSignal()
    await cleanupRunResources(runDir, controlServer, mcpServer, gateWaiter)
  }
}
