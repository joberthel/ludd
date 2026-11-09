import type {
  ControlClient,
  GateResolveParams,
  GateResolveResult,
  JsonRpcRequest,
  JsonRpcResponse,
  RunAbortParams,
  RunAbortResult,
  RunTeardownParams,
  RunTeardownResult,
} from '../types/ipc.js'
import type { RunStateSnapshot } from '../types/state.js'
import net from 'node:net'
import { JsonRpcResponseError } from '../errors/json-rpc-response-error.js'
import { getControlSocketPath } from './socket-path.js'

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
}

async function waitForConnection(socket: net.Socket): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    function onConnect(): void {
      socket.off('error', onError)
      resolve()
    }
    function onError(err: Error): void {
      socket.off('connect', onConnect)
      reject(err)
    }
    socket.once('connect', onConnect)
    socket.once('error', onError)
  })
}

async function destroySocket(socket: net.Socket): Promise<void> {
  await new Promise<void>((resolve) => {
    socket.once('close', () => resolve())
    socket.destroy()
  })
}

function handleResponseLine(
  line: string,
  pendingRequests: Map<string | number, PendingRequest>,
): void {
  try {
    const response = JSON.parse(line) as JsonRpcResponse
    if (typeof response !== 'object' || response === null || response.id === null || response.id === undefined) {
      return
    }
    const pending = pendingRequests.get(response.id)
    if (!pending) {
      return
    }
    pendingRequests.delete(response.id)
    if (response.error) {
      pending.reject(
        new JsonRpcResponseError(
          response.error.code,
          response.error.message,
          response.error.data,
        ),
      )
      return
    }
    pending.resolve(response.result)
  }
  catch {
    // Ignore unparseable frames from server
  }
}

function failAllPending(
  pendingRequests: Map<string | number, PendingRequest>,
  error: Error,
): void {
  for (const pending of pendingRequests.values()) {
    pending.reject(error)
  }
  pendingRequests.clear()
}

function attachClientFraming(
  socket: net.Socket,
  onLine: (line: string) => void,
): void {
  let buffer = ''
  socket.on('data', (chunk) => {
    buffer += chunk.toString('utf-8')
    let newlineIndex = buffer.indexOf('\n')
    while (newlineIndex !== -1) {
      const line = buffer.slice(0, newlineIndex).trim()
      buffer = buffer.slice(newlineIndex + 1)
      if (line.length > 0) {
        onLine(line)
      }
      newlineIndex = buffer.indexOf('\n')
    }
  })
}

function buildRpcPayload(id: number, method: string, params?: unknown): JsonRpcRequest {
  return {
    jsonrpc: '2.0',
    id,
    method,
    ...(params !== undefined
      ? { params }
      : {}),
  }
}

export async function createControlClient(runDir: string): Promise<ControlClient> {
  const socketPath = getControlSocketPath(runDir)
  const socket = net.createConnection(socketPath)
  await waitForConnection(socket)

  let nextId = 1
  let closed = false
  const pendingRequests = new Map<string | number, PendingRequest>()

  attachClientFraming(socket, line => handleResponseLine(line, pendingRequests))
  socket.on('error', err => failAllPending(pendingRequests, err))
  socket.on('close', () => {
    closed = true
    failAllPending(pendingRequests, new Error('Control client socket closed'))
  })

  const request = async <T = unknown>(method: string, params?: unknown): Promise<T> => {
    if (closed) {
      throw new Error('ControlClient is closed')
    }
    const id = nextId++
    return new Promise<T>((resolve, reject) => {
      pendingRequests.set(id, { resolve: resolve as (v: unknown) => void, reject })
      const payload = buildRpcPayload(id, method, params)
      socket.write(`${JSON.stringify(payload)}\n`, (err) => {
        if (err) {
          pendingRequests.delete(id)
          reject(err)
        }
      })
    })
  }

  const close = async (): Promise<void> => {
    if (closed) {
      return
    }
    closed = true
    await destroySocket(socket)
  }

  return {
    socketPath,
    status: async () => request<RunStateSnapshot>('run.status'),
    resolveGate: async (params: GateResolveParams) => request<GateResolveResult>('gate.resolve', params),
    abort: async (params?: RunAbortParams) => request<RunAbortResult>('run.abort', params),
    teardown: async (params?: RunTeardownParams) => request<RunTeardownResult>('run.teardown', params),
    request,
    close,
  }
}
