import type { ChildProcessByStdio } from 'node:child_process'
import type { Readable, Writable } from 'node:stream'
import { killProcessTree } from '@luddjs/core'

const STDERR_CAPTURE_LIMIT = 4096

export type AcpChildProcess = ChildProcessByStdio<Writable, Readable, Readable>

interface ChildMonitorState {
  stderr: string
  closed: boolean
  settled: boolean
  failureError: Error | undefined
}

export interface ChildProcessMonitor {
  closedPromise: Promise<void>
  failurePromise: Promise<never>
  markSettled: () => void
  getFailureError: () => Error
  ensureExited: (timeoutMs: number) => Promise<void>
}

export function noop(): void {}

function formatStderrSuffix(stderr: string): string {
  const trimmed = stderr.trim()
  return trimmed === ''
    ? ''
    : ` (stderr: ${trimmed})`
}

export function endChildStdin(child: AcpChildProcess): void {
  if (!child.stdin.destroyed && !child.stdin.writableEnded) {
    child.stdin.end()
  }
}

function attachProcessListeners(
  child: AcpChildProcess,
  command: string,
  state: ChildMonitorState,
  resolveClosed: () => void,
  rejectFailure: (error: Error) => void,
): void {
  const recordExitFailure = (buildMessage: () => string): void => {
    state.closed = true
    resolveClosed()
    state.failureError = new Error(buildMessage())
    if (!state.settled) {
      state.settled = true
      rejectFailure(state.failureError)
    }
  }

  child.stdin.on('error', noop)
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk: string) => {
    if (state.stderr.length < STDERR_CAPTURE_LIMIT) {
      state.stderr += chunk.slice(0, STDERR_CAPTURE_LIMIT - state.stderr.length)
    }
  })

  child.once('error', (err) => {
    recordExitFailure(() => `Failed to spawn ACP subprocess "${command}": ${err.message}${formatStderrSuffix(state.stderr)}`)
  })

  child.once('close', (code, signal) => {
    const signalNote = signal === null
      ? ''
      : ` (signal ${signal})`
    recordExitFailure(
      () => `ACP subprocess "${command}" exited unexpectedly with code ${String(code)}${signalNote}${formatStderrSuffix(state.stderr)}`,
    )
  })
}

export function createChildProcessMonitor(child: AcpChildProcess, command: string): ChildProcessMonitor {
  const state: ChildMonitorState = {
    stderr: '',
    closed: false,
    settled: false,
    failureError: undefined,
  }
  let resolveClosed!: () => void
  const closedPromise = new Promise<void>((resolve) => {
    resolveClosed = resolve
  })
  let rejectFailure!: (error: Error) => void
  const failurePromise = new Promise<never>((_resolve, reject) => {
    rejectFailure = reject
  })

  attachProcessListeners(child, command, state, resolveClosed, rejectFailure)

  return {
    closedPromise,
    failurePromise,
    markSettled: () => {
      state.settled = true
    },
    getFailureError: () => state.failureError as Error,
    ensureExited: async (timeoutMs: number): Promise<void> => {
      if (state.closed) {
        return
      }
      if (timeoutMs <= 0) {
        killProcessTree(child.pid)
        await closedPromise
        return
      }
      const timer = setTimeout(() => {
        killProcessTree(child.pid)
      }, timeoutMs)
      timer.unref()
      try {
        await closedPromise
      }
      finally {
        clearTimeout(timer)
      }
    },
  }
}

export async function waitWithTimeout(promises: readonly Promise<unknown>[], timeoutMs: number): Promise<void> {
  let timer!: NodeJS.Timeout
  const timeoutPromise = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs)
    timer.unref()
  })
  try {
    await Promise.race([...promises, timeoutPromise])
  }
  finally {
    clearTimeout(timer)
  }
}
