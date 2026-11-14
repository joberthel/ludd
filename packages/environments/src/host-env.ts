import type {
  DynamicProperty,
  EnvironmentAdapter,
  ProvisionContext,
  ProvisionedEnvironment,
} from '@ludd/core'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { execHostEnvCommand } from './host-process.js'
import { resolveEnvironmentVariables } from './isolation/env-resolver.js'

export { execHostEnvCommand, killProcessTree } from './host-process.js'

export interface HostEnvOptions {
  id?: string
  cwd?: string
  env?: DynamicProperty<Record<string, string>>
  ephemeralPorts?: readonly string[]
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

      return {
        __kind: 'environment',
        id,
        type: 'host',
        workingDir,
        ephemeralPorts: resolved.ephemeralPorts,
        injectedEnv: resolved.injectedEnv,
        exec: async (command, execOptions) => {
          const mergedEnv = resolved.injectedEnv !== undefined
            ? {
                ...resolved.injectedEnv,
                ...execOptions?.env,
              }
            : execOptions?.env
          return execHostEnvCommand(workingDir, command, {
            ...execOptions,
            env: mergedEnv,
          })
        },
        ping: async () => fs.existsSync(workingDir),
        teardown: async () => {},
      }
    },
  }
}
