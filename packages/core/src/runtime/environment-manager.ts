import type { StepContext } from '../types/context.js'
import type { ProvisionedEnvironment } from '../types/environment.js'
import type { Guardrail } from '../types/guardrail.js'
import type { StepConfig } from '../types/harness.js'
import type { RunStateSnapshot } from '../types/state.js'
import fs from 'node:fs'
import path from 'node:path'
import { EnvironmentUnreachableError } from '../errors/environment-unreachable-error.js'
import { writeRunStateAtomic } from '../persistence/state-store.js'
import { isProvisionedEnvironment } from '../types/environment.js'
import { resolveDynamicProperty } from '../utils/resolve-dynamic-property.js'
import { execHostCommand } from './environment-exec.js'

export { execHostCommand, killProcessTree } from './environment-exec.js'

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
    snapshot.environments[env.id] = {
      id: env.id,
      type: env.type,
      workingDir: env.workingDir,
    }
    if (runDir !== undefined) {
      snapshot.updatedAt = new Date().toISOString()
      writeRunStateAtomic(runDir, snapshot)
    }
  }
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
    if (!isProvisionedEnvironment(resolved)) {
      throw new Error(`Step "${step.id}" environment must resolve to a valid ProvisionedEnvironment.`)
    }
    env = resolved
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

export async function resolveGuardrailEnvironment(
  guardrail: Guardrail<any, any>,
  ctx: StepContext,
  stepEnvironment: ProvisionedEnvironment,
  snapshot?: RunStateSnapshot,
  runDir?: string,
): Promise<ProvisionedEnvironment> {
  if (guardrail.environment !== undefined) {
    const resolved = await resolveDynamicProperty(guardrail.environment, ctx)
    if (!isProvisionedEnvironment(resolved)) {
      throw new Error('Guardrail environment must resolve to a valid ProvisionedEnvironment.')
    }
    recordEnvironment(resolved, ctx, snapshot, runDir)
    return resolved
  }
  return stepEnvironment
}

export interface RehydrateEnvironmentsParams {
  previousEnvironments?: Record<string, { id: string, type: string, workingDir: string }>
  ctx: StepContext
  activeStep?: StepConfig
  workspaceDir: string
  snapshot?: RunStateSnapshot
  runDir?: string
  defaultSignal?: AbortSignal
}

export async function rehydrateEnvironmentsAndCheckHealth(
  params: RehydrateEnvironmentsParams,
): Promise<void> {
  const { previousEnvironments, ctx, activeStep, workspaceDir, snapshot, runDir, defaultSignal } = params

  if (previousEnvironments !== undefined) {
    for (const desc of Object.values(previousEnvironments)) {
      if (ctx.environments[desc.id] === undefined) {
        ctx.environments[desc.id] = createHostEnvironmentFromDescriptor(desc, defaultSignal)
      }
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
