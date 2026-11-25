import type { ChildProcessByStdio } from 'node:child_process'
import type { Readable } from 'node:stream'
import { spawn as nodeSpawn } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'
import { buildIsolatedEnvironmentVars } from './env-sanitizer.js'

const KILL_GRACE_PERIOD_MS = 200
const CLOSE_SAFETY_TIMEOUT_MS = KILL_GRACE_PERIOD_MS + 500

export interface HostSpawnOptions {
  /** Executable binary or command string. */
  command: string
  /** Optional CLI arguments passed to the command. */
  args?: readonly string[]
  /** Working directory for the spawned process. Defaults to `process.cwd()`. */
  cwd?: string
  /** Environment variables merged into the spawned process environment. */
  env?: Record<string, string>
  /** Optional abort signal used to cancel and terminate the child process tree. */
  signal?: AbortSignal
  /** Optional timeout in milliseconds after which the child process tree is terminated. */
  timeoutMs?: number
  /** When true, executes `command` through a shell. Defaults to `false`. */
  shell?: boolean
  /** When false (and `sanitizeEnv` is not true), omits host `process.env` inheritance. Defaults to `true`. */
  inheritEnv?: boolean
  /** When true, restricts inherited host variables via `buildIsolatedEnvironmentVars`. */
  sanitizeEnv?: boolean
  /** Host environment keys permitted when `sanitizeEnv` is enabled. */
  allowedEnvKeys?: readonly string[]
  /** Optional streaming callback invoked for each stdout chunk. */
  onStdout?: (chunk: string) => void
  /** Optional streaming callback invoked for each stderr chunk. */
  onStderr?: (chunk: string) => void
}

export interface HostSpawnResult {
  exitCode: number | null
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
  timedOut: boolean
}

type SpawnedChild = ChildProcessByStdio<null, Readable, Readable>

interface ExecutionState {
  stdout: string
  stderr: string
  terminating: boolean
  timedOut: boolean
  abortError: Error | undefined
  timeoutTimer: NodeJS.Timeout | undefined
  safetyTimer: NodeJS.Timeout | undefined
}

/** Terminates a child process and its process group, escalating from SIGTERM to SIGKILL. */
export function killProcessTree(pid: number | undefined, gracePeriodMs = KILL_GRACE_PERIOD_MS): void {
  if (pid === undefined || !Number.isInteger(pid) || pid <= 0) {
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
  timer.unref()
}

/** Extracts an `Error` instance from an `AbortSignal`'s abort reason. */
export function extractAbortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) {
    return signal.reason
  }
  return new Error(String(signal.reason ?? 'Command aborted'))
}

function resolveSpawnCwd(cwd?: string): string {
  if (cwd !== undefined && cwd.trim() !== '') {
    return path.resolve(cwd)
  }
  return process.cwd()
}

function resolveSpawnEnv(options: HostSpawnOptions): NodeJS.ProcessEnv {
  if (options.sanitizeEnv === true) {
    return buildIsolatedEnvironmentVars({
      whitelistEnv: options.allowedEnvKeys,
      injectedEnv: options.env,
    })
  }
  if (options.inheritEnv === false) {
    return { ...options.env }
  }
  return {
    ...process.env,
    ...options.env,
  }
}

function clearTimers(state: ExecutionState): void {
  if (state.timeoutTimer !== undefined) {
    clearTimeout(state.timeoutTimer)
    state.timeoutTimer = undefined
  }
  if (state.safetyTimer !== undefined) {
    clearTimeout(state.safetyTimer)
    state.safetyTimer = undefined
  }
}

function settleResult(
  state: ExecutionState,
  code: number | null,
  childSignal: NodeJS.Signals | null,
  resolve: (res: HostSpawnResult) => void,
  reject: (err: Error) => void,
): void {
  if (state.abortError !== undefined) {
    reject(state.abortError)
    return
  }
  if (state.timedOut) {
    resolve({
      exitCode: null,
      signal: null,
      stdout: state.stdout,
      stderr: state.stderr,
      timedOut: true,
    })
    return
  }
  resolve({
    exitCode: code,
    signal: childSignal,
    stdout: state.stdout,
    stderr: state.stderr,
    timedOut: false,
  })
}

function beginTermination(
  state: ExecutionState,
  child: SpawnedChild,
  reason: { timedOut: true } | { abortError: Error },
  onClose: (code: number | null, childSignal: NodeJS.Signals | null) => void,
): void {
  if (state.terminating) {
    return
  }
  state.terminating = true
  if ('timedOut' in reason) {
    state.timedOut = true
  }
  else {
    state.abortError = reason.abortError
  }
  if (state.timeoutTimer !== undefined) {
    clearTimeout(state.timeoutTimer)
    state.timeoutTimer = undefined
  }
  killProcessTree(child.pid, KILL_GRACE_PERIOD_MS)
  state.safetyTimer = setTimeout(onClose, CLOSE_SAFETY_TIMEOUT_MS, null, null)
  state.safetyTimer.unref()
}

function createExecutionState(): ExecutionState {
  return {
    stdout: '',
    stderr: '',
    terminating: false,
    timedOut: false,
    abortError: undefined,
    timeoutTimer: undefined,
    safetyTimer: undefined,
  }
}

function runChildLifecycle(
  child: SpawnedChild,
  options: HostSpawnOptions,
  resolve: (res: HostSpawnResult) => void,
  reject: (err: Error) => void,
): void {
  const state = createExecutionState()
  const onStdoutData = (chunk: string): void => {
    state.stdout += chunk
    options.onStdout?.(chunk)
  }
  const onStderrData = (chunk: string): void => {
    state.stderr += chunk
    options.onStderr?.(chunk)
  }
  const signal = options.signal
  const onClose = (code: number | null, childSignal: NodeJS.Signals | null): void => {
    clearTimers(state)
    cleanup()
    settleResult(state, code, childSignal, resolve, reject)
  }
  const onError = (err: Error): void => {
    clearTimers(state)
    cleanup()
    reject(err)
  }
  const onAbort = (): void => {
    const abortError = extractAbortError(signal!)
    beginTermination(state, child, { abortError }, onClose)
  }
  function cleanup(): void {
    child.stdout.off('data', onStdoutData)
    child.stderr.off('data', onStderrData)
    child.off('close', onClose)
    child.off('error', onError)
    if (signal) {
      signal.removeEventListener('abort', onAbort)
    }
  }
  attachChildIOAndTimers(child, state, options, onStdoutData, onStderrData, onClose, onError, onAbort)
}

function attachChildIOAndTimers(
  child: SpawnedChild,
  state: ExecutionState,
  options: HostSpawnOptions,
  onStdoutData: (chunk: string) => void,
  onStderrData: (chunk: string) => void,
  onClose: (code: number | null, childSignal: NodeJS.Signals | null) => void,
  onError: (err: Error) => void,
  onAbort: () => void,
): void {
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', onStdoutData)
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', onStderrData)
  child.once('error', onError)
  child.once('close', onClose)

  if (options.timeoutMs !== undefined && Number.isFinite(options.timeoutMs) && options.timeoutMs > 0) {
    state.timeoutTimer = setTimeout(() => {
      beginTermination(state, child, { timedOut: true }, onClose)
    }, options.timeoutMs)
  }

  if (options.signal) {
    options.signal.addEventListener('abort', onAbort, { once: true })
  }
}

/** Spawns a host subprocess with explicit cwd, env, optional env sanitization, streaming callbacks, and AbortSignal tree cleanup. */
export async function spawn(options: HostSpawnOptions): Promise<HostSpawnResult> {
  if (typeof options.command !== 'string' || options.command.trim() === '') {
    throw new Error('Host spawn "command" must be a non-empty string.')
  }
  if (options.signal?.aborted) {
    throw extractAbortError(options.signal)
  }

  const cwd = resolveSpawnCwd(options.cwd)
  const env = resolveSpawnEnv(options)
  const args = options.args
    ? [...options.args]
    : []

  return new Promise((resolve, reject) => {
    const child = nodeSpawn(options.command, args, {
      cwd,
      env,
      shell: options.shell ?? false,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    runChildLifecycle(child, options, resolve, reject)
  })
}
