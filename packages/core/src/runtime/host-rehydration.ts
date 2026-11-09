import type { ProvisionedEnvironment } from '../types/environment.js'
import fs from 'node:fs'
import path from 'node:path'
import { execHostCommand } from './environment-exec.js'

export function createHostEnvironmentFromDescriptor(descriptor: {
  id: string
  type: string
  workingDir: string
  ephemeralPorts?: Record<string, number>
  injectedEnv?: Record<string, string>
}, defaultSignal?: AbortSignal): ProvisionedEnvironment {
  const workingDir = path.resolve(descriptor.workingDir)
  return {
    __kind: 'environment',
    id: descriptor.id,
    type: descriptor.type,
    workingDir,
    ...(descriptor.ephemeralPorts !== undefined
      ? { ephemeralPorts: descriptor.ephemeralPorts }
      : {}),
    ...(descriptor.injectedEnv !== undefined
      ? { injectedEnv: descriptor.injectedEnv }
      : {}),
    exec: async (command, options) => execHostCommand(workingDir, command, {
      signal: options?.signal ?? defaultSignal,
      ...options,
      env: descriptor.injectedEnv
        ? {
            ...descriptor.injectedEnv,
            ...(options?.env ?? {}),
          }
        : options?.env,
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
