import type { ControlRpcHandlers, ControlServer } from '../../types/ipc.js'
import type { RunStateSnapshot } from '../../types/state.js'
import { mkdtemp, rm } from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { JsonRpcResponseError } from '../../errors/json-rpc-response-error.js'
import { createControlClient } from '../control-client.js'
import { startControlServer } from '../control-server.js'

function createFakeSnapshot(status: 'running' | 'passed' = 'running'): RunStateSnapshot {
  return {
    schemaVersion: 1,
    runId: 'client-test-run',
    harnessName: 'test-harness',
    workflowName: 'test-harness',
    status,
    activeStepId: 'step-1',
    steps: {},
    updatedAt: new Date().toISOString(),
  }
}

let tempDir: string
let server: ControlServer | undefined

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-client-test-'))
})

afterEach(async () => {
  vi.restoreAllMocks()
  if (server) {
    await server.close()
    server = undefined
  }
  await rm(tempDir, { recursive: true, force: true })
})

describe('control client status and queries', () => {
  it('connects to server and queries status', async () => {
    const snapshot = createFakeSnapshot('passed')
    server = await startControlServer(tempDir, {
      getStatus: () => snapshot,
    })

    const client = await createControlClient(tempDir)
    expect(client.socketPath).toBe(server.socketPath)

    const res = await client.status()
    expect(res.runId).toBe('client-test-run')
    expect(res.status).toBe('passed')

    await client.close()
  })

  it('performs custom request and receives result', async () => {
    const handlers: ControlRpcHandlers = {
      getStatus: () => createFakeSnapshot(),
      sum: (params: unknown) => {
        const { a, b } = params as { a: number, b: number }
        return a + b
      },
    }
    server = await startControlServer(tempDir, handlers)

    const client = await createControlClient(tempDir)
    const result = await client.request<number>('sum', { a: 15, b: 27 })
    expect(result).toBe(42)

    await client.close()
  })
})

describe('control client gate resolution', () => {
  it('invokes resolveGate RPC method via typed helper', async () => {
    let capturedParams: unknown
    const handlers: ControlRpcHandlers = {
      getStatus: () => createFakeSnapshot(),
      resolveGate: (params: unknown) => {
        capturedParams = params
        return { ok: true }
      },
    }
    server = await startControlServer(tempDir, handlers)

    const client = await createControlClient(tempDir)
    const result = await client.resolveGate({
      stepId: 'step-clarify',
      guardrailIndex: 0,
      action: 'pass',
      feedback: 'Approved by lead',
    })

    expect(result).toEqual({ ok: true })
    expect(capturedParams).toEqual({
      stepId: 'step-clarify',
      guardrailIndex: 0,
      action: 'pass',
      feedback: 'Approved by lead',
    })

    await client.close()
  })
})

describe('control client abort and teardown', () => {
  it('invokes run.abort RPC method via typed helper', async () => {
    let capturedParams: unknown
    const handlers: ControlRpcHandlers = {
      getStatus: () => createFakeSnapshot(),
      abort: (params: unknown) => {
        capturedParams = params
        return { ok: true }
      },
    }
    server = await startControlServer(tempDir, handlers)

    const client = await createControlClient(tempDir)
    const result = await client.abort({ reason: 'Manual abort', teardown: true })
    expect(result).toEqual({ ok: true })
    expect(capturedParams).toEqual({ reason: 'Manual abort', teardown: true })
    await client.close()
  })

  it('invokes run.teardown RPC method via typed helper', async () => {
    let capturedParams: unknown
    const handlers: ControlRpcHandlers = {
      getStatus: () => createFakeSnapshot(),
      teardown: (params: unknown) => {
        capturedParams = params
        return { ok: true }
      },
    }
    server = await startControlServer(tempDir, handlers)

    const client = await createControlClient(tempDir)
    const result = await client.teardown({ force: true })
    expect(result).toEqual({ ok: true })
    expect(capturedParams).toEqual({ force: true })
    await client.close()
  })
})

describe('control client RPC errors and schema payloads', () => {
  it('rejects with JsonRpcResponseError on RPC error response', async () => {
    server = await startControlServer(tempDir, {
      getStatus: () => createFakeSnapshot(),
    })

    const client = await createControlClient(tempDir)
    await expect(client.request('nonExistentMethod')).rejects.toThrow(JsonRpcResponseError)

    try {
      await client.request('nonExistentMethod')
    }
    catch (err) {
      expect(err).toBeInstanceOf(JsonRpcResponseError)
      const rpcErr = err as JsonRpcResponseError
      expect(rpcErr.code).toBe(-32601)
      expect(rpcErr.message).toContain('Method not found')
    }

    await client.close()
  })

  it('rejects with JsonRpcResponseError with data when server returns data payload', async () => {
    server = await startControlServer(tempDir, {
      getStatus: () => createFakeSnapshot(),
      failWithData: () => {
        const err = new Error('custom failure') as Error & { code?: number, data?: unknown }
        err.data = { details: 'debug-data' }
        throw err
      },
    })

    const client = await createControlClient(tempDir)
    await expect(client.request('failWithData')).rejects.toThrow(JsonRpcResponseError)
    await client.close()
  })
})

describe('control client stream fragmentation and line filtering', () => {
  it('handles fragmented responses and ignores unparseable lines', async () => {
    const fakeServer = net.createServer((sock) => {
      sock.on('data', () => {
        sock.write('invalid json line\n')
        sock.write('{"jsonrpc":"2.0",')
        setTimeout(() => {
          sock.write('"id":1,"result":{"runId":"chunked"}}\n')
        }, 20)
      })
    })

    const socketPath = path.join(tempDir, 'control.sock')
    await new Promise<void>(resolve => fakeServer.listen(socketPath, resolve))

    const client = await createControlClient(tempDir)
    const result = await client.request<{ runId: string }>('test')
    expect(result.runId).toBe('chunked')

    await client.close()
    await new Promise<void>(resolve => fakeServer.close(() => resolve()))
  })

  it('ignores invalid responses, unknown request id, and empty lines', async () => {
    const fakeServer = net.createServer((sock) => {
      sock.on('data', () => {
        sock.write('\n\n')
        sock.write('null\n')
        sock.write('123\n')
        sock.write('"string-literal"\n')
        sock.write('{"jsonrpc":"2.0"}\n')
        sock.write('{"jsonrpc":"2.0","id":null}\n')
        sock.write('{"jsonrpc":"2.0","id":9999,"result":"unknown"}\n')
        sock.write('{"jsonrpc":"2.0","id":1,"result":"expected"}\n')
      })
    })
    const socketPath = path.join(tempDir, 'control.sock')
    await new Promise<void>(resolve => fakeServer.listen(socketPath, resolve))

    const client = await createControlClient(tempDir)
    const res = await client.request<string>('test')
    expect(res).toBe('expected')

    await client.close()
    await new Promise<void>(resolve => fakeServer.close(() => resolve()))
  })
})
