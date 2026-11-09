import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { ArtifactClient, EmbeddedMcpServer } from '../types/artifact.js'
import { Buffer } from 'node:buffer'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import http from 'node:http'
import { createArtifactStore } from './artifact-store.js'
import { executeToolCall, handleInitialize, handleToolsList } from './mcp-tools.js'

function resolveAuthToken(authToken?: string): string {
  if (typeof authToken === 'string' && authToken.trim() !== '') {
    return authToken.trim()
  }
  return randomBytes(32).toString('hex')
}

function verifyAuthToken(authHeader: string | undefined, expectedToken: string): boolean {
  if (authHeader === undefined || !authHeader.startsWith('Bearer ')) {
    return false
  }
  const clientToken = authHeader.slice(7).trim()
  const clientBuffer = Buffer.from(clientToken, 'utf8')
  const expectedBuffer = Buffer.from(expectedToken, 'utf8')

  if (clientBuffer.length !== expectedBuffer.length) {
    timingSafeEqual(expectedBuffer, expectedBuffer)
    return false
  }
  return timingSafeEqual(clientBuffer, expectedBuffer)
}

function sendJson(res: ServerResponse, statusCode: number, data: unknown): void {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(data))
}

async function readRequestBody(req: IncomingMessage): Promise<string> {
  return new Promise<string>((resolve) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => {
      chunks.push(chunk)
    })
    req.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf8'))
    })
  })
}

async function dispatchJsonRpc(
  body: Record<string, unknown>,
  store: ArtifactClient,
): Promise<Record<string, unknown>> {
  const { id, method, params } = body
  if (method === 'initialize') {
    return handleInitialize(id)
  }
  if (method === 'tools/list') {
    return handleToolsList(id)
  }
  if (method === 'tools/call') {
    const p = typeof params === 'object' && params !== null
      ? (params as Record<string, unknown>)
      : undefined
    const toolName = typeof p?.name === 'string'
      ? p.name
      : ''
    const args = typeof p?.arguments === 'object' && p.arguments !== null
      ? (p.arguments as Record<string, unknown>)
      : undefined
    const toolResult = await executeToolCall(toolName, args, store)
    return { jsonrpc: '2.0', id, result: toolResult }
  }
  return {
    jsonrpc: '2.0',
    id: id ?? null,
    error: { code: -32601, message: 'Method not found' },
  }
}

function validateJsonRpcStructure(parsed: unknown): parsed is Record<string, unknown> {
  return (
    typeof parsed === 'object'
    && parsed !== null
    && !Array.isArray(parsed)
    && (parsed as Record<string, unknown>).jsonrpc === '2.0'
    && typeof (parsed as Record<string, unknown>).method === 'string'
  )
}

async function handleJsonRpcPost(
  req: IncomingMessage,
  res: ServerResponse,
  store: ArtifactClient,
): Promise<void> {
  const bodyText = await readRequestBody(req)

  let parsed: unknown
  try {
    parsed = JSON.parse(bodyText)
  }
  catch {
    sendJson(res, 200, {
      jsonrpc: '2.0',
      id: null,
      error: { code: -32700, message: 'Parse error' },
    })
    return
  }

  if (!validateJsonRpcStructure(parsed)) {
    const maybeId = typeof parsed === 'object' && parsed !== null && 'id' in parsed
      ? (parsed as Record<string, unknown>).id
      : null
    sendJson(res, 200, {
      jsonrpc: '2.0',
      id: maybeId ?? null,
      error: { code: -32600, message: 'Invalid Request' },
    })
    return
  }

  if (parsed.id === undefined) {
    await dispatchJsonRpc(parsed, store)
    res.writeHead(204)
    res.end()
    return
  }

  const response = await dispatchJsonRpc(parsed, store)
  sendJson(res, 200, response)
}

export async function handleIncomingRequest(
  req: IncomingMessage,
  res: ServerResponse,
  token: string,
  store: ArtifactClient,
  sseConnections: Set<ServerResponse>,
): Promise<void> {
  if (!verifyAuthToken(req.headers.authorization, token)) {
    sendJson(res, 401, { error: 'Unauthorized' })
    return
  }

  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  const pathname = url.pathname

  if (req.method === 'GET' && pathname === '/sse') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    })
    res.write('event: endpoint\ndata: /mcp\n\n')
    sseConnections.add(res)
    res.on('close', () => {
      sseConnections.delete(res)
    })
    return
  }

  if (req.method === 'POST' && (pathname === '/mcp' || pathname === '/message')) {
    await handleJsonRpcPost(req, res, store)
    return
  }

  sendJson(res, 404, { error: 'Not Found' })
}

export async function startEmbeddedMcpServer(
  runDir: string,
  authToken?: string,
): Promise<EmbeddedMcpServer> {
  const token = resolveAuthToken(authToken)
  const store = createArtifactStore(runDir)
  const sseConnections = new Set<ServerResponse>()

  const server = http.createServer((req, res) => {
    void handleIncomingRequest(req, res, token, store, sseConnections)
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject)
      resolve()
    })
  })

  const addr = server.address() as AddressInfo
  const port = addr.port
  const serverUrl = `http://127.0.0.1:${port}/mcp`

  return {
    url: serverUrl,
    port,
    authToken: token,
    close: async (): Promise<void> => {
      for (const conn of sseConnections) {
        conn.end()
      }
      sseConnections.clear()
      await new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err && (err as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING') {
            reject(err)
          }
          else {
            resolve()
          }
        })
        server.closeAllConnections?.()
      })
    },
  }
}
