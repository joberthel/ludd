export interface ForwardContext {
  endpoint: string
  token: string
  stdout: NodeJS.WritableStream
  stderr: NodeJS.WritableStream
  fetchImpl: typeof fetch
  signal: AbortSignal
}

export function formatErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : String(error)
}

export function writeStreamLine(stream: NodeJS.WritableStream, line: string): void {
  if (stream.writable) {
    stream.write(`${line}\n`)
  }
}

export function jsonRpcError(id: unknown, code: number, message: string): string {
  return JSON.stringify({
    jsonrpc: '2.0',
    id,
    error: { code, message },
  })
}

export function extractRequestId(parsed: unknown): unknown {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return undefined
  }
  return (parsed as Record<string, unknown>).id
}

async function handleUpstreamResponse(
  response: Response,
  requestId: unknown,
  ctx: ForwardContext,
): Promise<void> {
  if (response.status === 204) {
    return
  }

  const bodyText = await response.text()
  if (response.status !== 200) {
    const detail = bodyText.trim() !== ''
      ? `: ${bodyText.trim()}`
      : ''
    const message = `Upstream HTTP ${response.status}${detail}`
    writeStreamLine(ctx.stderr, `[ludd mcp-bridge] ${message}`)
    if (requestId !== undefined) {
      writeStreamLine(ctx.stdout, jsonRpcError(requestId, -32000, message))
    }
    return
  }

  try {
    const normalized = JSON.stringify(JSON.parse(bodyText))
    writeStreamLine(ctx.stdout, normalized)
  }
  catch (error: unknown) {
    const message = `Invalid JSON response from MCP server: ${formatErrorMessage(error)}`
    writeStreamLine(ctx.stderr, `[ludd mcp-bridge] ${message}`)
    if (requestId !== undefined) {
      writeStreamLine(ctx.stdout, jsonRpcError(requestId, -32603, message))
    }
  }
}

/**
 * Parses a single JSON-RPC line from stdin, forwards it via HTTP POST, and writes any response to stdout.
 */
export async function forwardJsonRpcLine(line: string, ctx: ForwardContext): Promise<void> {
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  }
  catch (error: unknown) {
    writeStreamLine(ctx.stderr, `[ludd mcp-bridge] Malformed JSON input: ${formatErrorMessage(error)}`)
    writeStreamLine(ctx.stdout, jsonRpcError(null, -32700, 'Parse error'))
    return
  }

  const requestId = extractRequestId(parsed)

  try {
    const response = await ctx.fetchImpl(ctx.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ctx.token}`,
      },
      body: line,
      signal: ctx.signal,
    })
    await handleUpstreamResponse(response, requestId, ctx)
  }
  catch (error: unknown) {
    const message = formatErrorMessage(error)
    writeStreamLine(ctx.stderr, `[ludd mcp-bridge] Request failed: ${message}`)
    if (requestId !== undefined) {
      writeStreamLine(ctx.stdout, jsonRpcError(requestId, -32603, `MCP transport error: ${message}`))
    }
  }
}
