import type {
  DynamicProperty,
  EnvironmentAdapter,
  EnvironmentDescriptor,
  ProvisionContext,
  ProvisionedEnvironment,
} from '@ludd/core'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import {
  execHostCommand as execHostEnvCommand,
  killProcessTree,
} from '@ludd/core'
import { resolveEnvironmentVariables } from './isolation/env-resolver.js'

export { execHostEnvCommand, killProcessTree }

export interface HostEnvOptions {
  id?: string
  cwd?: string
  env?: DynamicProperty<Record<string, string>>
  ephemeralPorts?: readonly string[]
}

function createHostProvisionedEnv(
  id: string,
  type: string,
  workingDir: string,
  ephemeralPorts?: Record<string, number>,
  injectedEnv?: Record<string, string>,
  defaultSignal?: AbortSignal,
): ProvisionedEnvironment {
  return {
    __kind: 'environment',
    id,
    type,
    workingDir,
    ...(ephemeralPorts !== undefined
      ? { ephemeralPorts }
      : {}),
    ...(injectedEnv !== undefined
      ? { injectedEnv }
      : {}),
    exec: async (command, execOptions) => {
      const mergedEnv = injectedEnv !== undefined
        ? {
            ...injectedEnv,
            ...execOptions?.env,
          }
        : execOptions?.env
      return execHostEnvCommand(workingDir, command, {
        ...execOptions,
        signal: execOptions?.signal ?? defaultSignal,
        env: mergedEnv,
      })
    },
    ping: async () => fs.existsSync(workingDir),
    teardown: async () => {},
  }
}

export function hostEnv(
  options?: HostEnvOptions,
  context?: Partial<ProvisionContext>,
): EnvironmentAdapter {
  const rawId = options?.id?.trim()
  const id = (rawId !== undefined && rawId.length > 0)
    ? rawId
    : 'host'

  return {
    __kind: 'environment-adapter',
    id,
    type: 'host',
    provision: async (provisionContext: ProvisionContext): Promise<ProvisionedEnvironment> => {
      const workingDir = path.resolve(options?.cwd ?? provisionContext.workspaceDir ?? process.cwd())
      const resolved = await resolveEnvironmentVariables(options ?? {}, {
        ...provisionContext,
        ...context,
        workspaceDir: workingDir,
      })

      return createHostProvisionedEnv(
        id,
        'host',
        workingDir,
        resolved.ephemeralPorts,
        resolved.injectedEnv,
        provisionContext.defaultSignal,
      )
    },
    rehydrate: (
      descriptor: EnvironmentDescriptor,
      provisionContext: ProvisionContext,
    ): ProvisionedEnvironment => {
      const workingDir = path.resolve(descriptor.workingDir)
      return createHostProvisionedEnv(
        descriptor.id,
        descriptor.type,
        workingDir,
        descriptor.ephemeralPorts,
        descriptor.injectedEnv,
        provisionContext.defaultSignal,
      )
    },
  }
}
