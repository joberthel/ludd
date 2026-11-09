import type { StepContext } from '../types/context.js'
import type { ProvisionedEnvironment } from '../types/environment.js'
import type { Guardrail } from '../types/guardrail.js'
import type { StepConfig } from '../types/harness.js'
import type { EnvironmentDescriptor, RunStateSnapshot } from '../types/state.js'
import fs from 'node:fs'
import path from 'node:path'
import { EnvironmentUnreachableError } from '../errors/environment-unreachable-error.js'
import { writeRunStateAtomic } from '../persistence/state-store.js'
import { isEnvironmentAdapter, isProvisionedEnvironment } from '../types/environment.js'
import { resolveDynamicProperty } from '../utils/resolve-dynamic-property.js'
import { createDockerWorktreeEnvironmentFromDescriptor } from './docker-worktree-rehydration.js'
import { execHostCommand } from './environment-exec.js'
import { createGitWorktreeEnvironmentFromDescriptor } from './git-worktree-rehydration.js'

export { createDockerWorktreeEnvironmentFromDescriptor } from './docker-worktree-rehydration.js'
export { execHostCommand, killProcessTree } from './environment-exec.js'
export { createGitWorktreeEnvironmentFromDescriptor } from './git-worktree-rehydration.js'

export function createHostEnvironmentFromDescriptor(descriptor: {
  id: string
  type: string
  workingDir: string
}, defaultSignal?: AbortSignal): ProvisionedEnvironment {
  const workingDir = path.resolve(descriptor.workingDir)
  return {
    __kind: 'environment',
    id: descriptor.id,
    type: descriptor.type,
    workingDir,
    exec: async (command, options) => execHostCommand(workingDir, command, {
      signal: options?.signal ?? defaultSignal,
      ...options,
    }),
    ping: async () => fs.existsSync(workingDir),
    teardown: async () => {},
  }
}

export function createDefaultHostEnvironment(
  workspaceDir: string,
  defaultSignal?: AbortSignal,
): ProvisionedEnvironment {
  return createHostEnvironmentFromDescriptor({
    id: 'host',
    type: 'host',
    workingDir: workspaceDir,
  }, defaultSignal)
}

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
  if (defaultSignal && step.environment !== undefined) {
    const originalExec = env.exec.bind(env)
    env.exec = async (command, options) => originalExec(command, {
      signal: options?.signal ?? defaultSignal,
      ...options,
    })
  }
  recordEnvironment(env, ctx, snapshot, runDir)
  return env
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
  guardrail: Guardrail<any, any>,
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
  workspaceDir: string
  snapshot?: RunStateSnapshot
  runDir?: string
  defaultSignal?: AbortSignal
}

function rehydrateEnvironmentDescriptor(
  desc: EnvironmentDescriptor,
  ctx: StepContext,
  workspaceDir: string,
  defaultSignal?: AbortSignal,
): void {
  if (desc.tornDown || ctx.environments[desc.id] !== undefined) {
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
  const { previousEnvironments, ctx, activeStep, workspaceDir, snapshot, runDir, defaultSignal } = params

  if (previousEnvironments !== undefined) {
    for (const desc of Object.values(previousEnvironments)) {
      rehydrateEnvironmentDescriptor(desc, ctx, workspaceDir, defaultSignal)
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
