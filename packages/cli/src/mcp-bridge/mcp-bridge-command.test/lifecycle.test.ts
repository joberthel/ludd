import process from 'node:process'
import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { mcpBridgeCommand, runMcpBridge } from '../mcp-bridge-command.js'

function collectStream(stream: PassThrough): () => string {
  let output = ''
  stream.setEncoding('utf8')
  stream.on('data', (chunk: string) => {
    output += chunk
  })
  return () => output
}

describe('mcp-bridge lifecycle and shutdown', () => {
  it('awaits in-flight requests on stdin EOF and ignores duplicate end/close events', async () => {
    const stdin = new PassThrough()
    const stdout = new PassThrough()
    const stderr = new PassThrough()
    const getStdout = collectStream(stdout)

    let releaseFetch!: () => void
    const fetchGate = new Promise<void>((resolve) => {
      releaseFetch = resolve
    })

    const fetchMock = vi.fn<typeof fetch>(async () => {
      await fetchGate
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: 7, result: {} }), { status: 200 })
    })

    const bridgePromise = runMcpBridge({
      endpoint: 'http://127.0.0.1:9000/mcp',
      token: 'tok',
      stdin,
      stdout,
      stderr,
      fetchImpl: fetchMock,
      registerSignalHandlers: false,
    })

    let settled = false
    void bridgePromise.then(() => {
      settled = true
    })

    stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'ping' })}\n`)
    stdin.end()
    stdin.emit('end')
    stdin.emit('close')
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(settled).toBe(false)

    releaseFetch()
    expect(await bridgePromise).toBe(0)
    expect(JSON.parse(getStdout().trim())).toEqual({ jsonrpc: '2.0', id: 7, result: {} })
  })

  it('handles abrupt stdin close without end event', async () => {
    const stdin = new PassThrough()
    const stdout = new PassThrough()
    const stderr = new PassThrough()

    const bridgePromise = runMcpBridge({
      endpoint: 'http://127.0.0.1:9000/mcp',
      token: 'tok',
      stdin,
      stdout,
      stderr,
      registerSignalHandlers: false,
    })

    stdin.destroy()
    expect(await bridgePromise).toBe(0)
  })

  it('aborts in-flight requests and exits with 1 on stdin error', async () => {
    const stdin = new PassThrough()
    const stdout = new PassThrough()
    const stderr = new PassThrough()
    const getStderr = collectStream(stderr)

    const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new Error('aborted'))
        })
      })
    })

    const bridgePromise = runMcpBridge({
      endpoint: 'http://127.0.0.1:9000/mcp',
      token: 'tok',
      stdin,
      stdout,
      stderr,
      fetchImpl: fetchMock,
      registerSignalHandlers: false,
    })

    stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' })}\n`)
    await new Promise(resolve => setTimeout(resolve, 10))
    stdin.emit('error', new Error('broken pipe'))

    expect(await bridgePromise).toBe(1)
    expect(getStderr()).toContain('stdin error: broken pipe')
  })

  it('shuts down cleanly on AbortSignal (active and pre-aborted)', async () => {
    const stdin1 = new PassThrough()
    const stdout1 = new PassThrough()
    const stderr1 = new PassThrough()
    const getStderr1 = collectStream(stderr1)
    const ac1 = new AbortController()

    const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new Error('signal aborted'))
        })
      })
    })

    const p1 = runMcpBridge({
      endpoint: 'http://127.0.0.1:9000/mcp',
      token: 'tok',
      stdin: stdin1,
      stdout: stdout1,
      stderr: stderr1,
      fetchImpl: fetchMock,
      signal: ac1.signal,
      registerSignalHandlers: false,
    })

    stdin1.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' })}\n`)
    await new Promise(resolve => setTimeout(resolve, 10))
    ac1.abort()
    expect(await p1).toBe(0)
    expect(getStderr1()).toContain('Aborted via signal.')

    const preAborted = new AbortController()
    preAborted.abort()
    const stderr2 = new PassThrough()
    const getStderr2 = collectStream(stderr2)
    const p2 = await runMcpBridge({
      endpoint: 'http://127.0.0.1:9000/mcp',
      token: 'tok',
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: stderr2,
      signal: preAborted.signal,
      registerSignalHandlers: false,
    })
    expect(p2).toBe(0)
    expect(getStderr2()).toContain('Aborted via signal.')
  })

  it('handles SIGINT and SIGTERM via process signal handlers and cleans up listeners', async () => {
    const baseSigInt = process.listenerCount('SIGINT')
    const baseSigTerm = process.listenerCount('SIGTERM')

    const stdin1 = new PassThrough()
    const stdout1 = new PassThrough()
    const stderr1 = new PassThrough()
    const getStderr1 = collectStream(stderr1)

    const p1 = runMcpBridge({
      endpoint: 'http://127.0.0.1:9000/mcp',
      token: 'tok',
      stdin: stdin1,
      stdout: stdout1,
      stderr: stderr1,
    })
    expect(process.listenerCount('SIGINT')).toBe(baseSigInt + 1)
    expect(process.listenerCount('SIGTERM')).toBe(baseSigTerm + 1)
    process.emit('SIGINT', 'SIGINT')
    expect(await p1).toBe(0)
    expect(getStderr1()).toContain('Received SIGINT, shutting down.')
    expect(process.listenerCount('SIGINT')).toBe(baseSigInt)
    expect(process.listenerCount('SIGTERM')).toBe(baseSigTerm)

    const stdin2 = new PassThrough()
    const stdout2 = new PassThrough()
    const stderr2 = new PassThrough()
    const getStderr2 = collectStream(stderr2)
    let releaseFetch!: () => void
    const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
      return new Promise((_resolve, reject) => {
        releaseFetch = () => reject(new Error('aborted'))
        init?.signal?.addEventListener('abort', releaseFetch)
      })
    })

    const p2 = runMcpBridge({
      endpoint: 'http://127.0.0.1:9000/mcp',
      token: 'tok',
      stdin: stdin2,
      stdout: stdout2,
      stderr: stderr2,
      fetchImpl: fetchMock,
    })
    expect(process.listenerCount('SIGINT')).toBe(baseSigInt + 1)
    expect(process.listenerCount('SIGTERM')).toBe(baseSigTerm + 1)
    stdin2.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'ping' })}\n`)
    stdin2.end()
    await new Promise(resolve => setTimeout(resolve, 10))
    process.emit('SIGTERM', 'SIGTERM')
    process.emit('SIGTERM', 'SIGTERM')
    expect(await p2).toBe(0)
    expect(getStderr2()).toContain('Received SIGTERM, shutting down.')
    expect(process.listenerCount('SIGINT')).toBe(baseSigInt)
    expect(process.listenerCount('SIGTERM')).toBe(baseSigTerm)
  })

  it('aborts cleanly on stdout stream errors such as EPIPE and cleans up listener', async () => {
    const stdin = new PassThrough()
    const stdout = new PassThrough()
    const stderr = new PassThrough()
    const getStderr = collectStream(stderr)

    const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new Error('aborted'))
        })
      })
    })

    const bridgePromise = runMcpBridge({
      endpoint: 'http://127.0.0.1:9000/mcp',
      token: 'tok',
      stdin,
      stdout,
      stderr,
      fetchImpl: fetchMock,
      registerSignalHandlers: false,
    })
    expect(stdout.listenerCount('error')).toBe(1)

    stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' })}\n`)
    await new Promise(resolve => setTimeout(resolve, 10))
    stdout.emit('error', new Error('EPIPE'))

    expect(await bridgePromise).toBe(1)
    expect(getStderr()).toContain('stdout error: EPIPE')
    expect(stdout.listenerCount('error')).toBe(0)
  })

  it('executes mcpBridgeCommand with default process streams and global fetch', async () => {
    const stdin = new PassThrough()
    const stdout = new PassThrough()
    const stderr = new PassThrough()
    const getStdout = collectStream(stdout)

    const originalStdin = process.stdin
    const originalStdout = process.stdout
    const originalStderr = process.stderr
    const originalExitCode = process.exitCode
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ jsonrpc: '2.0', id: 99, result: {} }), { status: 200 }),
    )

    Object.defineProperty(process, 'stdin', { value: stdin, configurable: true })
    Object.defineProperty(process, 'stdout', { value: stdout, configurable: true })
    Object.defineProperty(process, 'stderr', { value: stderr, configurable: true })

    try {
      const cmdPromise = mcpBridgeCommand([
        '--endpoint',
        'http://127.0.0.1:9000/mcp',
        '--token',
        'cli-tok',
      ])
      stdin.end(`${JSON.stringify({ jsonrpc: '2.0', id: 99, method: 'ping' })}\n`)
      await cmdPromise
      expect(process.exitCode).toBe(0)
      expect(JSON.parse(getStdout().trim())).toEqual({ jsonrpc: '2.0', id: 99, result: {} })
    }
    finally {
      fetchSpy.mockRestore()
      Object.defineProperty(process, 'stdin', { value: originalStdin, configurable: true })
      Object.defineProperty(process, 'stdout', { value: originalStdout, configurable: true })
      Object.defineProperty(process, 'stderr', { value: originalStderr, configurable: true })
      process.exitCode = originalExitCode
    }
  })
})
