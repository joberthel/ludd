import type { DynamicProperty, StepContext } from '../types/context.js'
import type {
  HarnessExecutionConfig,
  RunLifecycleContext,
  SetupResult,
  StepConfig,
} from '../types/harness.js'
import path from 'node:path'
import process from 'node:process'
import { validateEnvRecord, validateResolvedCwd } from '../define-harness-validators.js'
import { resolveDynamicProperty } from '../utils/resolve-dynamic-property.js'
import { extractAbortError } from './host-exec.js'

export interface ResolvedExecutionContext {
  cwd: string
  env: Record<string, string>
}

export interface ResolveRunExecutionContextOptions {
  config: Pick<HarnessExecutionConfig, 'cwd' | 'env'>
  lifecycleCtx: RunLifecycleContext
  setupResult?: SetupResult | void
}

export interface ResolveStepExecutionContextOptions<
  TContext extends StepContext = StepContext,
> {
  step: Pick<StepConfig<any, any, TContext, any, any, any, any>, 'cwd' | 'env'>
  stepCtx: TContext
  runExecutionContext: ResolvedExecutionContext
}

export interface ResolveExecutionContextOptions<
  TContext extends StepContext = StepContext,
> extends ResolveRunExecutionContextOptions {
  step?: Pick<StepConfig<any, any, TContext, any, any, any, any>, 'cwd' | 'env'>
  stepCtx?: TContext
}

export interface ExecuteWithHarnessLifecycleOptions<TResult> {
  config: HarnessExecutionConfig
  lifecycleCtx: RunLifecycleContext
  run: (
    executionContext: ResolvedExecutionContext,
    setupResult: SetupResult | undefined,
  ) => Promise<TResult> | TResult
  onTeardownError?: (error: unknown) => void
}

function resolveWorkspaceRoot(workspaceRoot: string): string {
  return typeof workspaceRoot === 'string' && workspaceRoot.trim() !== ''
    ? path.resolve(workspaceRoot)
    : process.cwd()
}

async function resolveCwdOverride<TContext>(
  cwdProp: DynamicProperty<string, TContext> | undefined,
  ctx: TContext,
  baseCwd: string,
  targetLabel: string,
): Promise<string | undefined> {
  if (cwdProp === undefined) {
    return undefined
  }
  const resolved = await resolveDynamicProperty(cwdProp, ctx)
  validateResolvedCwd(resolved, targetLabel)
  return path.resolve(baseCwd, resolved)
}

async function resolveEnvOverride<TContext>(
  envProp: DynamicProperty<Record<string, string>, TContext> | undefined,
  ctx: TContext,
  targetLabel: string,
): Promise<Record<string, string> | undefined> {
  if (envProp === undefined) {
    return undefined
  }
  const resolved = await resolveDynamicProperty(envProp, ctx)
  validateEnvRecord(resolved, targetLabel)
  return resolved
}

/** Resolves run-level `{ cwd, env }` from workspaceRoot, harness config, and optional setup result. */
export async function resolveRunExecutionContext(
  options: ResolveRunExecutionContextOptions,
): Promise<ResolvedExecutionContext> {
  const { config, lifecycleCtx, setupResult } = options
  const workspaceRoot = resolveWorkspaceRoot(lifecycleCtx.workspaceRoot)

  const harnessCwd = await resolveCwdOverride(
    config.cwd,
    lifecycleCtx,
    workspaceRoot,
    'Harness config',
  )
  let cwd = harnessCwd ?? workspaceRoot

  if (setupResult?.cwd !== undefined) {
    validateResolvedCwd(setupResult.cwd, 'Harness setup result')
    cwd = path.resolve(workspaceRoot, setupResult.cwd)
  }

  const harnessEnv = await resolveEnvOverride(config.env, lifecycleCtx, 'Harness config')
  let setupEnv: Record<string, string> | undefined
  if (setupResult?.env !== undefined) {
    validateEnvRecord(setupResult.env, 'Harness setup result')
    setupEnv = setupResult.env
  }

  return {
    cwd,
    env: {
      ...harnessEnv,
      ...setupEnv,
    },
  }
}

/** Resolves step-level `{ cwd, env }` overrides against the run-level execution context. */
export async function resolveStepExecutionContext<
  TContext extends StepContext = StepContext,
>(
  options: ResolveStepExecutionContextOptions<TContext>,
): Promise<ResolvedExecutionContext> {
  const { step, stepCtx, runExecutionContext } = options
  const targetLabel = 'Step config'

  const stepCwd = await resolveCwdOverride(
    step.cwd,
    stepCtx,
    runExecutionContext.cwd,
    targetLabel,
  )
  const stepEnv = await resolveEnvOverride(step.env, stepCtx, targetLabel)

  return {
    cwd: stepCwd ?? runExecutionContext.cwd,
    env: {
      ...runExecutionContext.env,
      ...stepEnv,
    },
  }
}

/** Resolves full `{ cwd, env }` combining workspaceRoot, setup result, harness defaults, and optional step overrides. */
export async function resolveExecutionContext<
  TContext extends StepContext = StepContext,
>(
  options: ResolveExecutionContextOptions<TContext>,
): Promise<ResolvedExecutionContext> {
  const runExecutionContext = await resolveRunExecutionContext(options)
  if (options.step === undefined) {
    return runExecutionContext
  }
  if (
    (typeof options.step.cwd === 'function' || typeof options.step.env === 'function')
    && options.stepCtx === undefined
  ) {
    throw new Error('stepCtx is required to resolve dynamic step "cwd" or "env".')
  }
  return resolveStepExecutionContext({
    step: options.step,
    stepCtx: options.stepCtx as TContext,
    runExecutionContext,
  })
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw extractAbortError(signal)
  }
}

/** Executes run-level `setup`, resolves `{ cwd, env }`, invokes `run`, and guarantees `teardown` without masking primary errors. */
export async function executeWithHarnessLifecycle<TResult>(
  options: ExecuteWithHarnessLifecycleOptions<TResult>,
): Promise<TResult> {
  const { config, lifecycleCtx, run, onTeardownError } = options
  let result!: TResult
  let primaryError: unknown
  let hasPrimaryError = false

  try {
    throwIfAborted(lifecycleCtx.signal)
    let setupResult: SetupResult | undefined
    if (config.setup !== undefined) {
      const raw = await config.setup(lifecycleCtx)
      if (raw) {
        setupResult = raw
      }
    }
    throwIfAborted(lifecycleCtx.signal)
    const executionContext = await resolveRunExecutionContext({
      config,
      lifecycleCtx,
      setupResult,
    })
    throwIfAborted(lifecycleCtx.signal)
    result = await run(executionContext, setupResult)
  }
  catch (error: unknown) {
    primaryError = error
    hasPrimaryError = true
  }

  if (config.teardown !== undefined) {
    try {
      await config.teardown(lifecycleCtx)
    }
    catch (teardownError: unknown) {
      if (!hasPrimaryError) {
        throw teardownError
      }
      onTeardownError?.(teardownError)
    }
  }

  if (hasPrimaryError) {
    throw primaryError
  }

  return result
}
