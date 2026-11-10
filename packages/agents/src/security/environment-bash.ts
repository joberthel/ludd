import type { BashOperations, ToolDefinition } from '@earendil-works/pi-coding-agent'
import type { ProvisionedEnvironment } from '@ludd/core'
import { Buffer } from 'node:buffer'
import { createBashToolDefinition } from '@earendil-works/pi-coding-agent'

/** Environment `type` discriminator of the docker adapter. */
export const DOCKER_ENVIRONMENT_TYPE = 'docker-worktree'

/** Routes shell commands through `environment.exec()` instead of a host shell. */
export function createEnvironmentBashOperations(environment: ProvisionedEnvironment): BashOperations {
  return {
    exec: async (command, _cwd, options) => {
      const result = await environment.exec(['sh', '-c', command], {
        signal: options.signal,
        ...(options.timeout === undefined
          ? {}
          : { timeoutMs: options.timeout * 1000 }),
      })
      options.onData(Buffer.from(result.stdout + result.stderr))
      if (result.timedOut) {
        throw new Error(`timeout:${options.timeout}`)
      }
      return { exitCode: result.exitCode }
    },
  }
}

/** Overrides `bash` with a container-delegating tool for docker environments; undefined otherwise. */
export function environmentBashTool(environment: ProvisionedEnvironment | undefined): ToolDefinition | undefined {
  if (environment?.type !== DOCKER_ENVIRONMENT_TYPE) {
    return undefined
  }
  return createBashToolDefinition(environment.workingDir, {
    operations: createEnvironmentBashOperations(environment),
  }) as unknown as ToolDefinition
}
