import { Buffer } from 'node:buffer'
import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { runMcpBridge } from '../mcp-bridge-command.js'
import { formatErrorMessage } from '../mcp-bridge-transport.js'

function collectStream(stream: PassThrough): () => string {
  let output = ''
  stream.setEncoding('utf8')
  stream.on('data', (chunk: string) => {
    output += chunk
  })
  return () => output
}

describe('mcp-bridge framing, protocol, and error handling', () => {
  it('handles chunked UTF-8 lines, CRLF, blank lines, trailing EOF line, and 204 notifications', async () => {
    const stdin = new PassThrough()
    const stdout = new PassThrough()
    const stderr = new PassThrough()
    const getStdout = collectStream(stdout)
    const getStderr = collectStream(stderr)

    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      const parsed = JSON.parse(String(init?.body)) as Record<string, unknown>
      if (parsed.id === undefined) {
        return new Response(null, { status: 204 })
      }
      return new Response(`{\n  "jsonrpc": "2.0",\n  "id": ${JSON.stringify(parsed.id)},\n  "result": {"echo": ${JSON.stringify(parsed.method)}}\n}`, {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })

    const bridgePromise = runMcpBridge({
      endpoint: 'http://127.0.0.1:9000/mcp',
      token: 'tok-123',
      stdin,
      stdout,
      stderr,
      fetchImpl: fetchMock,
      registerSignalHandlers: false,
    })

    const multiByteLine = `${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping-€' })}\r\n`
    const encoded = Buffer.from(multiByteLine, 'utf8')
    const splitAt = encoded.indexOf(0xE2) + 1
    stdin.write(encoded.subarray(0, splitAt))
    stdin.write(encoded.subarray(splitAt))
    stdin.write('\n   \r\n')
    stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`)
    stdin.setEncoding('utf8')
    stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 'last', method: 'tools/list' }))
    stdin.end()

    const exitCode = await bridgePromise
    expect(exitCode).toBe(0)
    expect(getStderr()).toBe('')
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:9000/mcp',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer tok-123',
        },
      }),
    )

    const lines = getStdout().trim().split('\n').map(line => JSON.parse(line))
    expect(lines).toEqual([
      {
        jsonrpc: '2.0',
        id: 1,
        result: { echo: 'ping-€' },
      },
      {
        jsonrpc: '2.0',
        id: 'last',
        result: { echo: 'tools/list' },
      },
    ])
  })

  it('emits -32700 Parse error on malformed JSON lines without forwarding upstream', async () => {
    const stdin = new PassThrough()
    const stdout = new PassThrough()
    const stderr = new PassThrough()
    const getStdout = collectStream(stdout)
    const getStderr = collectStream(stderr)
    const fetchMock = vi.fn<typeof fetch>()

    const bridgePromise = runMcpBridge({
      endpoint: 'http://127.0.0.1:9000/mcp',
      token: 'tok-123',
      stdin,
      stdout,
      stderr,
      fetchImpl: fetchMock,
      registerSignalHandlers: false,
    })

    stdin.end('{bad-json\n')
    expect(await bridgePromise).toBe(0)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(getStderr()).toContain('Malformed JSON input')
    expect(JSON.parse(getStdout().trim())).toEqual({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32700, message: 'Parse error' },
    })
  })

  it('handles upstream HTTP errors, invalid 200 JSON, and transport errors for requests vs notifications', async () => {
    const stdin = new PassThrough()
    const stdout = new PassThrough()
    const stderr = new PassThrough()
    const getStdout = collectStream(stdout)
    const getStderr = collectStream(stderr)

    const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
      const parsed = JSON.parse(String(init?.body)) as Record<string, unknown>
      if (Array.isArray(parsed)) {
        return new Response('not-json', { status: 200 })
      }
      if (parsed.method === 'notifications/test') {
        return new Response('', { status: 500 })
      }
      if (parsed.method === 'notifications/test2') {
        throw new Error('ECONNRESET')
      }
      if (parsed.id === 1) {
        return new Response('{"error":"Unauthorized"}', { status: 401 })
      }
      if (parsed.id === 2) {
        return new Response('not-json', { status: 200 })
      }
      if (parsed.id === 3) {
        throw new Error('ECONNREFUSED')
      }
      return new Response(null, { status: 204 })
    })

    const bridgePromise = runMcpBridge({
      endpoint: 'http://127.0.0.1:9000/mcp',
      token: 'tok-123',
      stdin,
      stdout,
      stderr,
      fetchImpl: fetchMock,
      registerSignalHandlers: false,
    })

    const inputs = [
      { jsonrpc: '2.0', id: 1, method: 'ping' },
      { jsonrpc: '2.0', method: 'notifications/test' },
      { jsonrpc: '2.0', id: 2, method: 'ping' },
      [1, 2, 3],
      { jsonrpc: '2.0', id: 3, method: 'ping' },
      { jsonrpc: '2.0', method: 'notifications/test2' },
    ]
    for (const item of inputs) {
      stdin.write(`${JSON.stringify(item)}\n`)
    }
    stdin.end()

    expect(await bridgePromise).toBe(0)
    const errText = getStderr()
    expect(errText).toContain('Upstream HTTP 401: {"error":"Unauthorized"}')
    expect(errText).toContain('Upstream HTTP 500')
    expect(errText).toContain('Invalid JSON response from MCP server')
    expect(errText).toContain('Request failed: ECONNREFUSED')
    expect(errText).toContain('Request failed: ECONNRESET')
    expect(formatErrorMessage('string-failure')).toBe('string-failure')
    expect(formatErrorMessage(new Error('boom'))).toBe('boom')

    const outLines = getStdout().trim().split('\n').map(line => JSON.parse(line) as Record<string, unknown>)
    expect(outLines).toHaveLength(3)
    expect(outLines).toEqual(expect.arrayContaining([
      {
        jsonrpc: '2.0',
        id: 1,
        error: { code: -32000, message: 'Upstream HTTP 401: {"error":"Unauthorized"}' },
      },
      {
        jsonrpc: '2.0',
        id: 2,
        error: {
          code: -32603,
          message: expect.stringContaining('Invalid JSON response from MCP server'),
        },
      },
      {
        jsonrpc: '2.0',
        id: 3,
        error: { code: -32603, message: 'MCP transport error: ECONNREFUSED' },
      },
    ]))
  })

  it('skips stdout writes safely if stdout is already ended', async () => {
    const stdin = new PassThrough()
    const stdout = new PassThrough()
    const stderr = new PassThrough()
    stdout.end()

    const fetchMock = vi.fn<typeof fetch>(async () => {
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }), { status: 200 })
    })

    const bridgePromise = runMcpBridge({
      endpoint: 'http://127.0.0.1:9000/mcp',
      token: 'tok-123',
      stdin,
      stdout,
      stderr,
      fetchImpl: fetchMock,
      registerSignalHandlers: false,
    })

    stdin.end(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' })}\n`)
    expect(await bridgePromise).toBe(0)
  })

  it('catches mid-body response.text() rejections cleanly without unhandled rejections', async () => {
    const stdin = new PassThrough()
    const stdout = new PassThrough()
    const stderr = new PassThrough()
    const getStdout = collectStream(stdout)
    const getStderr = collectStream(stderr)

    const fetchMock = vi.fn<typeof fetch>(async () => {
      return {
        status: 200,
        text: async () => Promise.reject(new Error('stream reset mid-body')),
      } as unknown as Response
    })

    const bridgePromise = runMcpBridge({
      endpoint: 'http://127.0.0.1:9000/mcp',
      token: 'tok-123',
      stdin,
      stdout,
      stderr,
      fetchImpl: fetchMock,
      registerSignalHandlers: false,
    })

    stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 'body-err', method: 'ping' })}\n`)
    stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/body-err' })}\n`)
    stdin.end()

    expect(await bridgePromise).toBe(0)
    expect(getStderr()).toContain('Request failed: stream reset mid-body')
    const outLines = getStdout().trim().split('\n').map(line => JSON.parse(line))
    expect(outLines).toEqual([
      {
        jsonrpc: '2.0',
        id: 'body-err',
        error: { code: -32603, message: 'MCP transport error: stream reset mid-body' },
      },
    ])
  })
})
