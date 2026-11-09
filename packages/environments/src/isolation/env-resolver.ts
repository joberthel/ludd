import type { DynamicProperty, ProvisionContext, StepContext } from '@ludd/core'
import process from 'node:process'
import { resolveDynamicProperty } from '@ludd/core'
import { allocateEphemeralPorts } from './port-allocator.js'

export interface DynamicEnvOptions {
  env?: DynamicProperty<Record<string, string>>
  ephemeralPorts?: readonly string[]
}

export interface ResolvedEnvironmentVars {
  ephemeralPorts?: Record<string, number>
  injectedEnv?: Record<string, string>
}

export async function resolveEnvironmentVariables(
  options: DynamicEnvOptions,
  context: Partial<ProvisionContext> = {},
): Promise<ResolvedEnvironmentVars> {
  let ephemeralPorts: Record<string, number> | undefined
  const portEnvVars: Record<string, string> = {}

  if (options.ephemeralPorts && options.ephemeralPorts.length > 0) {
    ephemeralPorts = await allocateEphemeralPorts(options.ephemeralPorts)
    for (const [name, port] of Object.entries(ephemeralPorts)) {
      portEnvVars[name] = String(port)
    }
  }

  let resolvedEnv: Record<string, string> | undefined
  if (options.env !== undefined) {
    const dynamicCtx = context.ctx ?? ({
      runId: context.runId ?? 'host',
      workspaceDir: context.workspaceDir ?? process.cwd(),
    } as unknown as StepContext)
    resolvedEnv = await resolveDynamicProperty(options.env, dynamicCtx)
  }

  const hasInjected = resolvedEnv !== undefined || ephemeralPorts !== undefined
  const injectedEnv = hasInjected
    ? {
        ...(resolvedEnv ?? {}),
        ...portEnvVars,
      }
    : undefined

  return {
    ...(ephemeralPorts !== undefined
      ? { ephemeralPorts }
      : {}),
    ...(injectedEnv !== undefined
      ? { injectedEnv }
      : {}),
  }
}
