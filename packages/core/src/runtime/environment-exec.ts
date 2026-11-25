import type {
  EnvironmentExecOptions,
  EnvironmentExecResult,
} from '../types/environment.js'
import path from 'node:path'
import { killProcessTree, spawn } from './host-exec.js'

export { killProcessTree }

function parseCommand(command: string | readonly string[]): {
  file: string
  args: readonly string[]
  shell: boolean
} {
  if (Array.isArray(command)) {
    if (command.length === 0) {
      throw new Error('Command array must not be empty.')
    }
    const file = String(command[0])
    const args = command.slice(1).map(String)
    return { file, args, shell: false }
  }
  if (typeof command === 'string') {
    if (command.trim() === '') {
      throw new Error('Command string must not be empty.')
    }
    return { file: command, args: [], shell: true }
  }
  throw new TypeError('Command must be a non-empty string or array of strings.')
}

function resolveExecCwd(workingDir: string, cwdOption?: string): string {
  if (cwdOption !== undefined && cwdOption.trim() !== '') {
    return path.resolve(workingDir, cwdOption)
  }
  return workingDir
}

export async function execHostCommand(
  workingDir: string,
  command: string | readonly string[],
  options?: EnvironmentExecOptions,
): Promise<EnvironmentExecResult> {
  const { file, args, shell } = parseCommand(command)
  const cwd = resolveExecCwd(workingDir, options?.cwd)
  const result = await spawn({
    command: file,
    args,
    cwd,
    env: options?.env,
    signal: options?.signal,
    timeoutMs: options?.timeoutMs,
    shell,
    inheritEnv: options?.inheritEnv,
  })
  return {
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
    timedOut: result.timedOut,
  }
}
