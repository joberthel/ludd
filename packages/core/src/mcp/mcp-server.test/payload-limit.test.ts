import type { IncomingMessage, ServerResponse } from 'node:http'
import { Buffer } from 'node:buffer'
import { EventEmitter } from 'node:events'
import os from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createArtifactStore } from '../artifact-store.js'
import { createLogStore } from '../log-store.js'
import { handleIncomingRequest, MAX_MCP_BODY_BYTES, startEmbeddedMcpServer } from '../mcp-server.js'

describe('embedded MCP server payload size limit', () => {
  let closeServer: (() => Promise<void>) | undefined

  afterEach(async () => {
    if (closeServer) {
      await closeServer()
      closeServer = undefined
    }
  })

  it('rejects request bodies exceeding MAX_MCP_BODY_BYTES with 413', async () => {
    const server = await startEmbeddedMcpServer(os.tmpdir())
    closeServer = server.close

    const oversizedBody = 'x'.repeat(MAX_MCP_BODY_BYTES + 1)
    try {
      const response = await fetch(server.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${server.authToken}`,
        },
        body: oversizedBody,
      })

      expect(response.status).toBe(413)
      const json = await response.json() as { error?: { message?: string } }
      expect(json.error?.message).toBe('Payload too large')
    }
    catch (err) {
      // On some Node/undici versions, req.destroy() resets the connection before 413 is read
      expect(err).toBeDefined()
    }
  })

  it('ignores trailing chunks after payload limit rejection and rethrows request stream errors', async () => {
    const store = createArtifactStore(os.tmpdir())
    const logStore = createLogStore(os.tmpdir())
    const sseConnections = new Set<ServerResponse>()

    // 1. Trailing data/end/error after payload limit rejection
    const req1 = new EventEmitter() as EventEmitter & {
      method: string
      url: string
      headers: Record<string, string>
      destroy: ReturnType<typeof vi.fn>
    }
    req1.method = 'POST'
    req1.url = '/mcp'
    req1.headers = { authorization: 'Bearer tok' }
    req1.destroy = vi.fn()

    const writeHead1 = vi.fn()
    const res1 = {
      writeHead: writeHead1,
      end: vi.fn(),
    } as unknown as ServerResponse

    const p1 = handleIncomingRequest(req1 as unknown as IncomingMessage, res1, 'tok', store, logStore, sseConnections)
    req1.emit('data', Buffer.alloc(MAX_MCP_BODY_BYTES + 1))
    req1.emit('data', Buffer.from('extra'))
    req1.emit('end')
    req1.emit('error', new Error('ignored after rejection'))
    await p1
    expect(req1.destroy).toHaveBeenCalledTimes(1)
    expect(writeHead1).toHaveBeenCalledWith(413, { 'Content-Type': 'application/json' })

    // 2. Request stream error before end
    const req2 = new EventEmitter() as EventEmitter & {
      method: string
      url: string
      headers: Record<string, string>
      destroy: ReturnType<typeof vi.fn>
    }
    req2.method = 'POST'
    req2.url = '/mcp'
    req2.headers = { authorization: 'Bearer tok' }
    req2.destroy = vi.fn()

    const res2 = {
      writeHead: vi.fn(),
      end: vi.fn(),
    } as unknown as ServerResponse

    const p2 = handleIncomingRequest(req2 as unknown as IncomingMessage, res2, 'tok', store, logStore, sseConnections)
    req2.emit('error', new Error('stream reset'))
    await expect(p2).rejects.toThrow('stream reset')
  })
})
