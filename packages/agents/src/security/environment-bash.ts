import type { BashOperations, ToolDefinition } from '@earendil-works/pi-coding-agent'
import { Buffer } from 'node:buffer'
import path from 'node:path'
import { createBashToolDefinition } from '@earendil-works/pi-coding-agent'
import { spawn } from '@luddjs/core'

export interface HostBashOptions {
  cwd: string
  env?: Record<string, string>
  signal?: AbortSignal
}

function combineSignals(a?: AbortSignal, b?: AbortSignal): AbortSignal | undefined {
  if (a !== undefined && b !== undefined) {
    return AbortSignal.any([a, b])
  }
  return a ?? b
}

function mergeEnvVars(
  hostEnv?: Record<string, string>,
  execEnv?: NodeJS.ProcessEnv,
): Record<string, string> {
  const merged: Record<string, string> = {}
  if (execEnv !== undefined) {
    for (const [key, value] of Object.entries(execEnv)) {
      if (value !== undefined) {
        merged[key] = value
      }
    }
  }
  if (hostEnv !== undefined) {
    for (const [key, value] of Object.entries(hostEnv)) {
      merged[key] = value
    }
  }
  return merged
}

/** Routes shell commands through `@luddjs/core` host `spawn` using `{ cwd, env, signal }`. */
export function createEnvironmentBashOperations(hostOptions: HostBashOptions): BashOperations {
  return {
    exec: async (command, cwd, options) => {
      const resolvedCwd = typeof cwd === 'string' && cwd.trim() !== ''
        ? path.resolve(hostOptions.cwd, cwd)
        : hostOptions.cwd
      const signal = combineSignals(hostOptions.signal, options.signal)
      const env = mergeEnvVars(hostOptions.env, options.env)
      const result = await spawn({
        command: 'sh',
        args: ['-c', command],
        cwd: resolvedCwd,
        env,
        ...(signal === undefined
          ? {}
          : { signal }),
        ...(options.timeout === undefined
          ? {}
          : { timeoutMs: options.timeout * 1000 }),
        onStdout: chunk => options.onData(Buffer.from(chunk)),
        onStderr: chunk => options.onData(Buffer.from(chunk)),
      })
      if (result.timedOut) {
        throw new Error(`timeout:${options.timeout}`)
      }
      return { exitCode: result.exitCode }
    },
  }
}

/** Provides a host-`spawn`-backed `bash` tool bound to `{ cwd, env, signal }`. */
export function environmentBashTool(options: HostBashOptions | undefined): ToolDefinition | undefined {
  if (options === undefined) {
    return undefined
  }
  return createBashToolDefinition(options.cwd, {
    operations: createEnvironmentBashOperations(options),
  }) as unknown as ToolDefinition
}
