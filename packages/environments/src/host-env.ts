import type {
  DynamicProperty,
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

interface EnvState {
  ports?: Record<string, number>
  injectedEnv?: Record<string, string>
}

function createHostEnvironmentObject(
  id: string,
  workingDir: string,
  state: EnvState,
  initPromise: Promise<void>,
): ProvisionedEnvironment {
  const env: ProvisionedEnvironment = {
    __kind: 'environment',
    id,
    type: 'host',
    workingDir,
    get ephemeralPorts() {
      return state.ports
    },
    get injectedEnv() {
      return state.injectedEnv
    },
    exec: async (command, execOptions) => {
      await initPromise
      const mergedEnv = state.injectedEnv !== undefined
        ? {
            ...state.injectedEnv,
            ...execOptions?.env,
          }
        : execOptions?.env
      return execHostEnvCommand(workingDir, command, {
        ...execOptions,
        env: mergedEnv,
      })
    },
    ping: async () => {
      await initPromise
      return fs.existsSync(workingDir)
    },
    teardown: async () => {},
  }
  return env
}

export function hostEnv(
  options?: HostEnvOptions,
  context?: Partial<ProvisionContext>,
): ProvisionedEnvironment {
  const rawId = options?.id?.trim()
  const id = (rawId !== undefined && rawId.length > 0)
    ? rawId
    : 'host'
  const workingDir = path.resolve(options?.cwd ?? process.cwd())

  const state: EnvState = {}
  const initPromise = resolveEnvironmentVariables(options ?? {}, {
    workspaceDir: workingDir,
    ...context,
  }).then((res) => {
    state.ports = res.ephemeralPorts
    state.injectedEnv = res.injectedEnv
  })
  initPromise.catch(() => {})

  return createHostEnvironmentObject(id, workingDir, state, initPromise)
}
