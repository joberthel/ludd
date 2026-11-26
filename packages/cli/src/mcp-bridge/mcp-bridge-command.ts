import type { ForwardContext } from './mcp-bridge-transport.js'
import { Buffer } from 'node:buffer'
import process from 'node:process'
import { StringDecoder } from 'node:string_decoder'
import { parse, text } from '../worker/parse-args.js'
import { formatErrorMessage, forwardJsonRpcLine, writeStreamLine } from './mcp-bridge-transport.js'

export interface McpBridgeConfig {
  endpoint: string
  token: string
}

export interface McpBridgeOptions {
  endpoint: string
  token: string
  stdin?: NodeJS.ReadableStream
  stdout?: NodeJS.WritableStream
  stderr?: NodeJS.WritableStream
  fetchImpl?: typeof fetch
  signal?: AbortSignal
  registerSignalHandlers?: boolean
}

function validateEndpoint(rawEndpoint: string | undefined): string {
  if (rawEndpoint === undefined || rawEndpoint.trim() === '') {
    throw new Error('Missing MCP endpoint URL (--endpoint or LUDD_MCP_ENDPOINT).')
  }
  const trimmedEndpoint = rawEndpoint.trim()
  let parsedUrl: URL
  try {
    parsedUrl = new URL(trimmedEndpoint)
  }
  catch {
    throw new Error(`Invalid MCP endpoint URL: "${trimmedEndpoint}".`)
  }
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new Error(`Invalid MCP endpoint URL protocol "${parsedUrl.protocol}". Expected http: or https:.`)
  }
  return parsedUrl.toString()
}

/**
 * Parses CLI flags and environment variables for `ludd mcp-bridge`.
 */
export function parseMcpBridgeArgs(
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): McpBridgeConfig {
  const { values, positionals } = parse(args, {
    endpoint: { type: 'string' },
    token: { type: 'string' },
  })
  if (positionals.length > 0) {
    throw new Error('Unexpected positional arguments for mcp-bridge.')
  }

  const endpoint = validateEndpoint(text(values, 'endpoint') ?? env.LUDD_MCP_ENDPOINT)
  const rawToken = text(values, 'token') ?? env.LUDD_MCP_TOKEN
  if (rawToken === undefined || rawToken.trim() === '') {
    throw new Error('Missing MCP auth token (--token or LUDD_MCP_TOKEN).')
  }

  return {
    endpoint,
    token: rawToken.trim(),
  }
}

interface BridgeState {
  stdin: NodeJS.ReadableStream
  stderr: NodeJS.WritableStream
  controller: AbortController
  decoder: StringDecoder
  inFlight: Set<Promise<void>>
  ctx: ForwardContext
  registerSignalHandlers: boolean
  signal?: AbortSignal
  buffer: string
  closed: boolean
  resolve: (exitCode: number) => void
}

function dispatchLine(state: BridgeState, rawLine: string): void {
  const line = rawLine.endsWith('\r')
    ? rawLine.slice(0, -1)
    : rawLine
  if (line.trim() === '') {
    return
  }
  const task = forwardJsonRpcLine(line, state.ctx).finally(() => {
    state.inFlight.delete(task)
  })
  state.inFlight.add(task)
}

function finishBridge(
  state: BridgeState,
  cleanupStdin: () => void,
  cleanupSignals: () => void,
  exitCode: number,
): void {
  cleanupStdin()
  void Promise.allSettled([...state.inFlight]).then(() => {
    cleanupSignals()
    state.resolve(exitCode)
  })
}

function handleChunk(state: BridgeState, chunk: Buffer | string): void {
  state.buffer += Buffer.isBuffer(chunk)
    ? state.decoder.write(chunk)
    : chunk
  let newlineIndex = state.buffer.indexOf('\n')
  while (newlineIndex !== -1) {
    const line = state.buffer.slice(0, newlineIndex)
    state.buffer = state.buffer.slice(newlineIndex + 1)
    dispatchLine(state, line)
    newlineIndex = state.buffer.indexOf('\n')
  }
}

function abortBridge(
  state: BridgeState,
  cleanupStdin: () => void,
  cleanupAfterDrain: () => void,
  reason: string,
  exitCode: number,
): void {
  if (!state.controller.signal.aborted) {
    writeStreamLine(state.stderr, `[ludd mcp-bridge] ${reason}`)
    state.controller.abort(new Error(reason))
  }
  if (!state.closed) {
    state.closed = true
    finishBridge(state, cleanupStdin, cleanupAfterDrain, exitCode)
  }
}

function handleEnd(state: BridgeState, cleanupStdin: () => void, cleanupAfterDrain: () => void): void {
  state.closed = true
  state.buffer += state.decoder.end()
  if (state.buffer !== '') {
    dispatchLine(state, state.buffer)
    state.buffer = ''
  }
  finishBridge(state, cleanupStdin, cleanupAfterDrain, 0)
}

function handleClose(state: BridgeState, cleanupStdin: () => void, cleanupAfterDrain: () => void): void {
  state.closed = true
  finishBridge(state, cleanupStdin, cleanupAfterDrain, 0)
}

function handleError(
  state: BridgeState,
  cleanupStdin: () => void,
  cleanupAfterDrain: () => void,
  error: unknown,
): void {
  state.closed = true
  writeStreamLine(state.stderr, `[ludd mcp-bridge] stdin error: ${formatErrorMessage(error)}`)
  state.controller.abort(error)
  finishBridge(state, cleanupStdin, cleanupAfterDrain, 1)
}

function attachBridgeListeners(state: BridgeState): void {
  const onData = (chunk: Buffer | string): void => handleChunk(state, chunk)
  const onSigInt = (): void => abortBridge(state, cleanupStdin, cleanupAfterDrain, 'Received SIGINT, shutting down.', 0)
  const onSigTerm = (): void => abortBridge(state, cleanupStdin, cleanupAfterDrain, 'Received SIGTERM, shutting down.', 0)
  const onExternalAbort = (): void => abortBridge(state, cleanupStdin, cleanupAfterDrain, 'Aborted via signal.', 0)
  const onStdoutError = (error: unknown): void => {
    abortBridge(state, cleanupStdin, cleanupAfterDrain, `stdout error: ${formatErrorMessage(error)}`, 1)
  }
  const onEnd = (): void => handleEnd(state, cleanupStdin, cleanupAfterDrain)
  const onClose = (): void => handleClose(state, cleanupStdin, cleanupAfterDrain)
  const onError = (error: unknown): void => handleError(state, cleanupStdin, cleanupAfterDrain, error)

  function cleanupStdin(): void {
    state.stdin.off('data', onData)
    state.stdin.off('end', onEnd)
    state.stdin.off('close', onClose)
    state.stdin.off('error', onError)
    state.stdin.pause()
  }

  function cleanupAfterDrain(): void {
    state.ctx.stdout.off('error', onStdoutError)
    if (state.registerSignalHandlers) {
      process.off('SIGINT', onSigInt)
      process.off('SIGTERM', onSigTerm)
    }
    state.signal?.removeEventListener('abort', onExternalAbort)
  }

  state.ctx.stdout.on('error', onStdoutError)
  if (state.registerSignalHandlers) {
    process.on('SIGINT', onSigInt)
    process.on('SIGTERM', onSigTerm)
  }
  state.signal?.addEventListener('abort', onExternalAbort, { once: true })
  if (state.signal?.aborted) {
    abortBridge(state, cleanupStdin, cleanupAfterDrain, 'Aborted via signal.', 0)
    return
  }
  state.stdin.on('data', onData)
  state.stdin.on('end', onEnd)
  state.stdin.on('close', onClose)
  state.stdin.on('error', onError)
  state.stdin.resume()
}

/**
 * Runs the newline-delimited JSON-RPC stdio-to-HTTP bridge until EOF or shutdown signal.
 */
export async function runMcpBridge(options: McpBridgeOptions): Promise<number> {
  const controller = new AbortController()
  const stdin = options.stdin ?? process.stdin
  const stderr = options.stderr ?? process.stderr

  return new Promise<number>((resolve) => {
    const state: BridgeState = {
      stdin,
      stderr,
      controller,
      decoder: new StringDecoder('utf8'),
      inFlight: new Set<Promise<void>>(),
      registerSignalHandlers: options.registerSignalHandlers ?? true,
      signal: options.signal,
      buffer: '',
      closed: false,
      resolve,
      ctx: {
        endpoint: options.endpoint,
        token: options.token,
        stdout: options.stdout ?? process.stdout,
        stderr,
        fetchImpl: options.fetchImpl ?? fetch,
        signal: controller.signal,
      },
    }
    attachBridgeListeners(state)
  })
}

/**
 * CLI entrypoint for `ludd mcp-bridge`.
 */
export async function mcpBridgeCommand(args: string[]): Promise<void> {
  const config = parseMcpBridgeArgs(args)
  process.exitCode = await runMcpBridge(config)
}
