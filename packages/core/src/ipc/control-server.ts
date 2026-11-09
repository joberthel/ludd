import type {
  ControlRpcHandlers,
  ControlServer,
  JsonRpcErrorResponse,
  JsonRpcId,
  JsonRpcRequest,
  JsonRpcResponse,
} from '../types/ipc.js'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import process from 'node:process'
import { JsonRpcResponseError } from '../errors/json-rpc-response-error.js'
import {
  JSON_RPC_INTERNAL_ERROR,
  JSON_RPC_INVALID_PARAMS,
  JSON_RPC_INVALID_REQUEST,
  JSON_RPC_METHOD_NOT_FOUND,
  JSON_RPC_PARSE_ERROR,
} from '../types/ipc.js'
import { CONTROL_SOCKET_NAME, getControlSocketPath } from './socket-path.js'

function extractId(raw: unknown): JsonRpcId {
  const id = typeof raw === 'object' && raw !== null && 'id' in raw
    ? (raw as Record<string, unknown>).id
    : undefined
  return typeof id === 'string' || typeof id === 'number' || id === null
    ? id
    : null
}

function makeErrorResponse(id: JsonRpcId, code: number, message: string): JsonRpcErrorResponse {
  return {
    jsonrpc: '2.0',
    id,
    error: { code, message },
  }
}

function checkRequestFormat(req: Record<string, unknown>, id: JsonRpcId): JsonRpcErrorResponse | null {
  if (req.jsonrpc !== '2.0' || typeof req.method !== 'string') {
    return makeErrorResponse(id, JSON_RPC_INVALID_REQUEST, 'Invalid Request')
  }
  if (req.id !== undefined && typeof req.id !== 'string' && typeof req.id !== 'number' && req.id !== null) {
    return makeErrorResponse(null, JSON_RPC_INVALID_REQUEST, 'Invalid Request')
  }
  if (req.params !== undefined && (typeof req.params !== 'object' || req.params === null)) {
    return makeErrorResponse(id, JSON_RPC_INVALID_PARAMS, 'Invalid params')
  }
  return null
}

export function validateJsonRpcRequest(raw: unknown): {
  valid: boolean
  request?: JsonRpcRequest
  errorResponse?: JsonRpcErrorResponse
} {
  const id = extractId(raw)

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return {
      valid: false,
      errorResponse: makeErrorResponse(null, JSON_RPC_INVALID_REQUEST, 'Invalid Request'),
    }
  }

  const req = raw as Record<string, unknown>
  const formatError = checkRequestFormat(req, id)
  if (formatError !== null) {
    return { valid: false, errorResponse: formatError }
  }

  return { valid: true, request: req as unknown as JsonRpcRequest }
}

async function invokeRpcMethod(
  request: JsonRpcRequest,
  handlers: ControlRpcHandlers,
): Promise<{ ok: true, result: unknown } | { ok: false, notFound: true }> {
  if (request.method === 'run.status') {
    return { ok: true, result: await handlers.getStatus() }
  }
  if (request.method === 'gate.resolve' && handlers.resolveGate) {
    return { ok: true, result: await handlers.resolveGate(request.params) }
  }
  if (request.method === 'run.abort' && handlers.abort) {
    return { ok: true, result: await handlers.abort(request.params) }
  }
  if (request.method === 'run.teardown' && handlers.teardown) {
    return { ok: true, result: await handlers.teardown(request.params) }
  }
  const customHandler = handlers[request.method]
  return typeof customHandler === 'function'
    ? { ok: true, result: await customHandler(request.params) }
    : { ok: false, notFound: true }
}

export async function dispatchRpcRequest(
  request: JsonRpcRequest,
  handlers: ControlRpcHandlers,
): Promise<JsonRpcResponse | null> {
  const isNotification = request.id === undefined
  const id = request.id ?? null

  try {
    const outcome = await invokeRpcMethod(request, handlers)
    if (!outcome.ok) {
      return isNotification
        ? null
        : makeErrorResponse(id, JSON_RPC_METHOD_NOT_FOUND, `Method not found: ${request.method}`)
    }
    return isNotification
      ? null
      : { jsonrpc: '2.0', id, result: outcome.result }
  }
  catch (error: unknown) {
    if (isNotification) {
      return null
    }
    if (error instanceof JsonRpcResponseError) {
      return makeErrorResponse(id, error.code, error.message)
    }
    const message = error instanceof Error
      ? error.message
      : 'Internal error'
    return makeErrorResponse(id, JSON_RPC_INTERNAL_ERROR, message)
  }
}

export async function handleRpcMessage(
  line: string,
  handlers: ControlRpcHandlers,
): Promise<JsonRpcResponse | null> {
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  }
  catch {
    return makeErrorResponse(null, JSON_RPC_PARSE_ERROR, 'Parse error')
  }

  const validation = validateJsonRpcRequest(parsed)
  if (!validation.valid) {
    return validation.errorResponse!
  }

  return dispatchRpcRequest(validation.request!, handlers)
}

function attachSocketLineBuffer(socket: net.Socket, onLine: (line: string) => void): void {
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

async function processSocketMessage(
  socket: net.Socket,
  line: string,
  handlers: ControlRpcHandlers,
): Promise<void> {
  const response = await handleRpcMessage(line, handlers)
  if (response !== null && !socket.destroyed) {
    await new Promise<void>((resolve) => {
      socket.write(`${JSON.stringify(response)}\n`, () => resolve())
    })
  }
}

function cleanUpSocketFiles(socketPath: string, runDir: string): void {
  fs.rmSync(socketPath, { force: true })
  fs.rmSync(path.join(runDir, CONTROL_SOCKET_NAME), { force: true })
}

async function closeActiveConnections(
  sockets: Set<net.Socket>,
  inFlight: Set<Promise<void>>,
): Promise<void> {
  await Promise.allSettled(Array.from(inFlight))
  for (const socket of sockets) {
    socket.destroy()
  }
  sockets.clear()
}

async function listenServer(server: net.Server, socketPath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(socketPath, () => {
      server.off('error', reject)
      resolve()
    })
  })
}

export async function startControlServer(
  runDir: string,
  handlers: ControlRpcHandlers,
): Promise<ControlServer> {
  const socketPath = getControlSocketPath(runDir)

  if (process.platform !== 'win32') {
    fs.mkdirSync(path.dirname(socketPath), { recursive: true })
    fs.rmSync(socketPath, { force: true })
  }

  const inFlightRequests = new Set<Promise<void>>()
  const activeSockets = new Set<net.Socket>()
  const server = net.createServer((socket) => {
    activeSockets.add(socket)
    attachSocketLineBuffer(socket, (line) => {
      const p = processSocketMessage(socket, line, handlers)
      inFlightRequests.add(p)
      void p.finally(() => inFlightRequests.delete(p))
    })
    socket.on('close', () => activeSockets.delete(socket))
    socket.on('error', () => activeSockets.delete(socket))
  })

  await listenServer(server, socketPath)

  let closed = false
  const close = async (): Promise<void> => {
    if (closed) {
      return
    }
    closed = true
    await closeActiveConnections(activeSockets, inFlightRequests)
    await new Promise<void>((resolve) => {
      server.close(() => resolve())
    })
    if (process.platform !== 'win32') {
      cleanUpSocketFiles(socketPath, runDir)
    }
  }

  return { socketPath, close }
}
