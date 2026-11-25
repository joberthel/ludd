import type { DynamicProperty, StepContext } from '../types/context.js'
import type { EnvironmentAdapter, ProvisionedEnvironment } from '../types/environment.js'
import type { Guardrail } from '../types/guardrail.js'
import type { StepConfig } from '../types/harness.js'
import type { EnvironmentDescriptor, RunStateSnapshot } from '../types/state.js'
import { EnvironmentUnreachableError } from '../errors/environment-unreachable-error.js'
import { writeRunStateAtomic } from '../persistence/state-store.js'
import { isEnvironmentAdapter, isProvisionedEnvironment } from '../types/environment.js'
import { resolveDynamicProperty } from '../utils/resolve-dynamic-property.js'
import { createDockerWorktreeEnvironmentFromDescriptor } from './docker-worktree-rehydration.js'
import { createGitWorktreeEnvironmentFromDescriptor } from './git-worktree-rehydration.js'
import {
  createDefaultHostEnvironment,
  createHostEnvironmentFromDescriptor,
} from './host-rehydration.js'

export { createDockerWorktreeEnvironmentFromDescriptor } from './docker-worktree-rehydration.js'
export { execHostCommand, killProcessTree } from './environment-exec.js'
export { createGitWorktreeEnvironmentFromDescriptor } from './git-worktree-rehydration.js'
export {
  createDefaultHostEnvironment,
  createHostEnvironmentFromDescriptor,
} from './host-rehydration.js'

export function recordEnvironment(
  env: ProvisionedEnvironment,
  ctx: StepContext,
  snapshot?: RunStateSnapshot,
  runDir?: string,
): void {
  ctx.environments[env.id] = env
  if (snapshot !== undefined) {
    if (!snapshot.environments) {
      snapshot.environments = {}
    }
    const containerId = (env as { containerId?: string }).containerId
    snapshot.environments[env.id] = {
      id: env.id,
      type: env.type,
      workingDir: env.workingDir,
      ...(env.branchName !== undefined
        ? { branchName: env.branchName }
        : {}),
      ...(containerId !== undefined
        ? { containerId }
        : {}),
      ...(env.containerWorkingDir !== undefined
        ? { containerWorkingDir: env.containerWorkingDir }
        : {}),
      ...(env.bridgeHost !== undefined
        ? { bridgeHost: env.bridgeHost }
        : {}),
      ...(env.whitelistEnv !== undefined
        ? {
            whitelistEnv: [...env.whitelistEnv],
          }
        : {}),
      ...(env.ephemeralPorts !== undefined
        ? { ephemeralPorts: env.ephemeralPorts }
        : {}),
      ...(env.injectedEnv !== undefined
        ? { injectedEnv: env.injectedEnv }
        : {}),
      tornDown: false,
    }
    if (runDir !== undefined) {
      snapshot.updatedAt = new Date().toISOString()
      writeRunStateAtomic(runDir, snapshot)
    }
  }
}

async function resolveAdapterOrEnvironment(
  resolved: unknown,
  ctx: StepContext,
  workspaceDir: string,
  stepId: string,
  defaultSignal?: AbortSignal,
): Promise<ProvisionedEnvironment> {
  if (isEnvironmentAdapter(resolved)) {
    if (ctx.environments[resolved.id] !== undefined) {
      return ctx.environments[resolved.id]
    }
    const provisioned = await resolved.provision({
      runId: ctx.runId,
      workspaceDir,
      defaultSignal,
      ctx,
    })
    ctx.environments[resolved.id] = provisioned
    return provisioned
  }
  if (isProvisionedEnvironment(resolved)) {
    return resolved
  }
  throw new Error(`Step "${stepId}" environment must resolve to a valid ProvisionedEnvironment.`)
}

export async function resolveStepEnvironment(
  step: StepConfig,
  ctx: StepContext,
  workspaceDir: string,
  snapshot?: RunStateSnapshot,
  runDir?: string,
  defaultSignal?: AbortSignal,
): Promise<ProvisionedEnvironment> {
  let env: ProvisionedEnvironment
  if (step.environment !== undefined) {
    const resolved = await resolveDynamicProperty(step.environment, ctx)
    env = await resolveAdapterOrEnvironment(resolved, ctx, workspaceDir, step.id, defaultSignal)
  }
  else {
    env = createDefaultHostEnvironment(workspaceDir, defaultSignal)
  }
  const stepDangerMode = step.dangerMode !== undefined
    ? Boolean(step.dangerMode)
    : undefined
  const needsWrap = (defaultSignal !== undefined && step.environment !== undefined) || stepDangerMode !== undefined
  const stepEnv: ProvisionedEnvironment = needsWrap
    ? {
        ...env,
        exec: async (command, options) => env.exec(command, {
          ...options,
          ...(options?.signal !== undefined || defaultSignal !== undefined
            ? { signal: options?.signal ?? defaultSignal }
            : {}),
          ...(options?.dangerMode !== undefined || stepDangerMode !== undefined
            ? { dangerMode: options?.dangerMode ?? stepDangerMode }
            : {}),
        }),
      }
    : env
  recordEnvironment(stepEnv, ctx, snapshot, runDir)
  return stepEnv
}

async function resolveGuardrailAdapterOrEnv(
  resolved: unknown,
  ctx: StepContext,
  stepEnvironment: ProvisionedEnvironment,
): Promise<ProvisionedEnvironment> {
  if (isEnvironmentAdapter(resolved)) {
    if (ctx.environments[resolved.id] !== undefined) {
      return ctx.environments[resolved.id]
    }
    const provisioned = await resolved.provision({
      runId: ctx.runId,
      workspaceDir: stepEnvironment.workingDir,
      ctx,
    })
    ctx.environments[resolved.id] = provisioned
    return provisioned
  }
  if (isProvisionedEnvironment(resolved)) {
    return resolved
  }
  throw new Error('Guardrail environment must resolve to a valid ProvisionedEnvironment.')
}

export async function resolveGuardrailEnvironment(
  guardrail: Guardrail<any, any> & {
    readonly environment?: DynamicProperty<ProvisionedEnvironment | EnvironmentAdapter, any>
  },
  ctx: StepContext,
  stepEnvironment: ProvisionedEnvironment,
  snapshot?: RunStateSnapshot,
  runDir?: string,
): Promise<ProvisionedEnvironment> {
  if (guardrail.environment !== undefined) {
    const resolved = await resolveDynamicProperty(guardrail.environment, ctx)
    const env = await resolveGuardrailAdapterOrEnv(resolved, ctx, stepEnvironment)
    recordEnvironment(env, ctx, snapshot, runDir)
    return env
  }
  return stepEnvironment
}

export interface RehydrateEnvironmentsParams {
  previousEnvironments?: Record<string, EnvironmentDescriptor>
  ctx: StepContext
  activeStep?: StepConfig
  adapters?: readonly EnvironmentAdapter[]
  workspaceDir: string
  snapshot?: RunStateSnapshot
  runDir?: string
  defaultSignal?: AbortSignal
}

function findMatchingRehydrateAdapter(
  desc: EnvironmentDescriptor,
  adapters: readonly EnvironmentAdapter[],
): EnvironmentAdapter | undefined {
  const byId = adapters.find(
    adapter => adapter.id === desc.id && typeof adapter.rehydrate === 'function',
  )
  if (byId !== undefined) {
    return byId
  }
  return adapters.find(
    adapter => adapter.type === desc.type && typeof adapter.rehydrate === 'function',
  )
}

async function rehydrateEnvironmentDescriptor(
  desc: EnvironmentDescriptor,
  ctx: StepContext,
  workspaceDir: string,
  defaultSignal?: AbortSignal,
  adapters: readonly EnvironmentAdapter[] = [],
): Promise<void> {
  if (desc.tornDown || ctx.environments[desc.id] !== undefined) {
    return
  }
  const matchingAdapter = findMatchingRehydrateAdapter(desc, adapters)
  if (matchingAdapter?.rehydrate !== undefined) {
    ctx.environments[desc.id] = await matchingAdapter.rehydrate(desc, {
      runId: ctx.runId,
      workspaceDir,
      defaultSignal,
      ctx,
    })
    return
  }
  if (desc.type === 'docker-worktree') {
    ctx.environments[desc.id] = createDockerWorktreeEnvironmentFromDescriptor(desc, defaultSignal, workspaceDir)
    return
  }
  ctx.environments[desc.id] = desc.type === 'git-worktree'
    ? createGitWorktreeEnvironmentFromDescriptor(desc, defaultSignal, workspaceDir)
    : createHostEnvironmentFromDescriptor(desc, defaultSignal)
}

export async function rehydrateEnvironmentsAndCheckHealth(
  params: RehydrateEnvironmentsParams,
): Promise<void> {
  const { previousEnvironments, ctx, activeStep, adapters = [], workspaceDir, snapshot, runDir, defaultSignal } = params

  const candidateAdapters: EnvironmentAdapter[] = [...adapters]
  if (activeStep?.environment !== undefined) {
    const resolvedStepEnv = await resolveDynamicProperty(activeStep.environment, ctx)
    if (isEnvironmentAdapter(resolvedStepEnv)) {
      candidateAdapters.unshift(resolvedStepEnv)
    }
  }

  if (previousEnvironments !== undefined) {
    for (const desc of Object.values(previousEnvironments)) {
      await rehydrateEnvironmentDescriptor(desc, ctx, workspaceDir, defaultSignal, candidateAdapters)
    }
  }

  if (activeStep?.environment !== undefined) {
    await resolveStepEnvironment(activeStep, ctx, workspaceDir, snapshot, runDir, defaultSignal)
  }

  for (const env of Object.values(ctx.environments)) {
    const reachable = await env.ping()
    if (!reachable) {
      throw new EnvironmentUnreachableError(env.id, env.workingDir)
    }
  }
}
