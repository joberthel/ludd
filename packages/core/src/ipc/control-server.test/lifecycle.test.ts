import type { RunStateSnapshot } from '../../types/state.js'
import { mkdtemp, rm } from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startControlServer } from '../control-server.js'

function createFakeSnapshot(): RunStateSnapshot {
  return {
    schemaVersion: 1,
    runId: 'lifecycle-test-run',
    harnessName: 'test-harness',
    workflowName: 'test-harness',
    status: 'running',
    activeStepId: 'step-a',
    steps: {},
    updatedAt: new Date().toISOString(),
  }
}

describe('startControlServer lifecycle and standard communication', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-server-test-'))
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await rm(tempDir, { recursive: true, force: true })
  })

  it('serves RPC requests over socket and cleans up on close', async () => {
    const snapshot = createFakeSnapshot()
    const server = await startControlServer(tempDir, {
      getStatus: () => snapshot,
    })

    const socket = net.createConnection(server.socketPath)
    await new Promise<void>(resolve => socket.once('connect', resolve))

    const responsePromise = new Promise<string>((resolve) => {
      socket.once('data', chunk => resolve(chunk.toString('utf-8')))
    })

    socket.write('\n\n')
    socket.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'run.status' })}\n`)
    const rawResponse = await responsePromise
    const parsed = JSON.parse(rawResponse.trim())
    expect(parsed.result.runId).toBe('lifecycle-test-run')

    socket.destroy()
    await server.close()
    await expect(server.close()).resolves.toBeUndefined()
  })

  it('handles message streaming across multiple chunks', async () => {
    const server = await startControlServer(tempDir, {
      getStatus: () => createFakeSnapshot(),
    })
    const socket = net.createConnection(server.socketPath)
    await new Promise<void>(resolve => socket.once('connect', resolve))

    const responsePromise = new Promise<string>((resolve) => {
      socket.once('data', chunk => resolve(chunk.toString('utf-8')))
    })

    const fullMessage = `${JSON.stringify({ jsonrpc: '2.0', id: 99, method: 'run.status' })}\n`
    socket.write(fullMessage.slice(0, 10))
    await new Promise(r => setTimeout(r, 20))
    socket.write(fullMessage.slice(10))

    const rawResponse = await responsePromise
    const parsed = JSON.parse(rawResponse.trim())
    expect(parsed.id).toBe(99)

    socket.destroy()
    await server.close()
  })
})

describe('startControlServer socket interruption and deep directory cleanup', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-server-test-'))
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await rm(tempDir, { recursive: true, force: true })
  })

  it('skips writing response if client socket was destroyed while awaiting handler', async () => {
    let clientSocket: net.Socket | undefined
    const server = await startControlServer(tempDir, {
      getStatus: async () => {
        clientSocket?.destroy()
        await new Promise(r => setTimeout(r, 20))
        return createFakeSnapshot()
      },
    })

    clientSocket = net.createConnection(server.socketPath)
    await new Promise<void>(resolve => clientSocket.once('connect', resolve))

    clientSocket.write(`${JSON.stringify({ jsonrpc: '2.0', id: 55, method: 'run.status' })}\n`)
    await new Promise(r => setTimeout(r, 60))

    await server.close()
  })

  it('handles server-side client socket error events and deep path cleanup', async () => {
    let serverSocket: net.Socket | undefined
    const origCreateServer = net.createServer
    vi.spyOn(net, 'createServer').mockImplementationOnce((...args: any[]) => {
      const s = (origCreateServer as any).apply(net, args)
      s.on('connection', (sock: net.Socket) => {
        serverSocket = sock
      })
      return s
    })

    const deepDir = path.join(tempDir, 'very-long-nested-directory-path-to-force-hashed-tmp-socket-name/runs/run-1')
    const server = await startControlServer(deepDir, {
      getStatus: () => createFakeSnapshot(),
    })

    const client = net.createConnection(server.socketPath)
    client.on('error', () => {})
    await new Promise<void>(resolve => client.once('connect', resolve))

    serverSocket?.emit('error', new Error('Simulated server socket error'))
    await new Promise(r => setTimeout(r, 20))

    client.destroy()
    await server.close()
  })
})

describe('startControlServer win32 platform and startup error handling', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-server-test-'))
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await rm(tempDir, { recursive: true, force: true })
  })

  it('supports win32 platform without touching filesystem socket files', async () => {
    const originalPlatform = process.platform
    try {
      Object.defineProperty(process, 'platform', { value: 'win32' })
      const server = await startControlServer(tempDir, {
        getStatus: () => createFakeSnapshot(),
      })
      expect(server.socketPath.startsWith('\\\\.\\pipe\\ludd-')).toBe(true)
      await server.close()
    }
    finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform })
    }
  })

  it('rejects startup if server listen emits error', async () => {
    const invalidPath = '/non/existent/path/that/cannot/be/created/for/socket/control.sock'
    await expect(startControlServer(invalidPath, {
      getStatus: () => createFakeSnapshot(),
    })).rejects.toThrow()
  })
})
