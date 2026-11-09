import type {
  EnvironmentExecOptions,
  EnvironmentExecResult,
  ProvisionedEnvironment,
} from '@ludd/core'
import type { ChildProcess } from 'node:child_process'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

export interface HostEnvOptions {
  id?: string
  cwd?: string
}

interface ExecutionState {
  stdout: string
  stderr: string
  settled: boolean
}

export function killProcessTree(pid: number | undefined, gracePeriodMs = 200): void {
  if (pid === undefined || pid === 0) {
    return
  }
  const target = process.platform === 'win32'
    ? pid
    : -pid
  try {
    process.kill(target, 'SIGTERM')
  }
  catch {
    return
  }
  const timer = setTimeout(() => {
    try {
      process.kill(target, 'SIGKILL')
    }
    catch {
      // Process already terminated
    }
  }, gracePeriodMs)
  timer.unref?.()
}

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
    return {
      file,
      args,
      shell: false,
    }
  }
  if (typeof command === 'string') {
    if (command.trim() === '') {
      throw new Error('Command string must not be empty.')
    }
    return {
      file: command,
      args: [],
      shell: true,
    }
  }
  throw new TypeError('Command must be a non-empty string or array of strings.')
}

function resolveExecCwd(workingDir: string, cwdOption?: string): string {
  if (cwdOption !== undefined && cwdOption.trim() !== '') {
    return path.resolve(workingDir, cwdOption)
  }
  return workingDir
}

function attachChildStreams(child: ChildProcess, state: ExecutionState): void {
  child.stdout?.on('data', (chunk: unknown) => {
    state.stdout += String(chunk)
  })
  child.stderr?.on('data', (chunk: unknown) => {
    state.stderr += String(chunk)
  })
}

function setupTimeoutTimer(
  pid: number | undefined,
  timeoutMs: number | undefined,
  state: ExecutionState,
  resolve: (res: EnvironmentExecResult) => void,
): NodeJS.Timeout | undefined {
  if (timeoutMs === undefined || timeoutMs <= 0) {
    return undefined
  }
  return setTimeout(() => {
    state.settled = true
    killProcessTree(pid)
    resolve({
      exitCode: null,
      stdout: state.stdout,
      stderr: state.stderr,
      timedOut: true,
    })
  }, timeoutMs)
}

function extractAbortError(signal: AbortSignal | undefined): Error {
  if (signal?.reason instanceof Error) {
    return signal.reason
  }
  return new Error(String(signal?.reason ?? 'Command aborted'))
}

function setupAbortSignal(
  signal: AbortSignal | undefined,
  child: ChildProcess,
  timer: NodeJS.Timeout | undefined,
  state: ExecutionState,
  reject: (err: Error) => void,
): void {
  if (!signal) {
    return
  }
  const onAbort = (): void => {
    state.settled = true
    if (timer !== undefined) {
      clearTimeout(timer)
    }
    killProcessTree(child.pid)
    reject(extractAbortError(signal))
  }
  const cleanup = (): void => {
    signal.removeEventListener('abort', onAbort)
  }
  signal.addEventListener('abort', onAbort, { once: true })
  child.once('close', cleanup)
  child.once('error', cleanup)
}

function attachProcessLifecycle(
  child: ChildProcess,
  timer: NodeJS.Timeout | undefined,
  state: ExecutionState,
  resolve: (res: EnvironmentExecResult) => void,
  reject: (err: Error) => void,
): void {
  child.on('error', (err: Error) => {
    if (timer !== undefined) {
      clearTimeout(timer)
    }
    state.settled = true
    reject(err)
  })

  child.on('close', (code: number | null) => {
    if (timer !== undefined) {
      clearTimeout(timer)
    }
    if (!state.settled) {
      state.settled = true
      resolve({
        exitCode: code,
        stdout: state.stdout,
        stderr: state.stderr,
        timedOut: false,
      })
    }
  })
}

export async function execHostEnvCommand(
  workingDir: string,
  command: string | readonly string[],
  options?: EnvironmentExecOptions,
): Promise<EnvironmentExecResult> {
  const { file, args, shell } = parseCommand(command)
  const cwd = resolveExecCwd(workingDir, options?.cwd)
  const env: NodeJS.ProcessEnv = options?.inheritEnv === false
    ? {
        ...options?.env,
      }
    : {
        ...process.env,
        ...options?.env,
      }

  return new Promise((resolve, reject) => {
    if (options?.signal?.aborted) {
      reject(extractAbortError(options.signal))
      return
    }

    const child = spawn(file, args as string[], {
      cwd,
      env,
      shell,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const state: ExecutionState = { stdout: '', stderr: '', settled: false }
    attachChildStreams(child, state)
    const timer = setupTimeoutTimer(child.pid, options?.timeoutMs, state, resolve)
    attachProcessLifecycle(child, timer, state, resolve, reject)
    setupAbortSignal(options?.signal, child, timer, state, reject)
  })
}

export function hostEnv(options?: HostEnvOptions): ProvisionedEnvironment {
  const rawId = options?.id?.trim()
  const id = (rawId !== undefined && rawId.length > 0)
    ? rawId
    : 'host'
  const workingDir = path.resolve(options?.cwd ?? process.cwd())

  return {
    __kind: 'environment',
    id,
    type: 'host',
    workingDir,
    exec: async (command, execOptions) => execHostEnvCommand(workingDir, command, execOptions),
    ping: async () => fs.existsSync(workingDir),
    teardown: async () => {},
  }
}
