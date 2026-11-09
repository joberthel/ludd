import type * as http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleIncomingRequest, startEmbeddedMcpServer } from '../mcp-server.js'

describe('embedded MCP server route dispatching', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ludd-mcp-rpc-routes-'))
  })

  afterEach(async () => {
    await fs.promises.rm(tempDir, { recursive: true, force: true })
  })

  it('supports both POST /mcp and POST /message routes', async () => {
    const server = await startEmbeddedMcpServer(tempDir)
    try {
      for (const route of ['/mcp', '/message']) {
        const res = await fetch(`http://127.0.0.1:${server.port}${route}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${server.authToken}`,
          },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
        })
        expect(res.status).toBe(200)
        const data = await res.json()
        expect(data.result.serverInfo.name).toBe('ludd-harness-mcp')
      }
    }
    finally {
      await server.close()
    }
  })
})

describe('embedded MCP server 404 route handling', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ludd-mcp-rpc-routes-'))
  })

  afterEach(async () => {
    await fs.promises.rm(tempDir, { recursive: true, force: true })
  })

  it('returns 404 for unknown route or method', async () => {
    const server = await startEmbeddedMcpServer(tempDir)
    try {
      const res1 = await fetch(`http://127.0.0.1:${server.port}/unknown-path`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${server.authToken}` },
      })
      expect(res1.status).toBe(404)

      const res2 = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${server.authToken}` },
      })
      expect(res2.status).toBe(404)
    }
    finally {
      await server.close()
    }
  })

  it('handles incoming request with undefined url fallback', async () => {
    const server = await startEmbeddedMcpServer(tempDir)
    try {
      const mockReq = {
        headers: { authorization: `Bearer ${server.authToken}` },
        url: undefined,
        method: 'GET',
      } as unknown as http.IncomingMessage
      const writeHead = vi.fn()
      const mockRes = {
        writeHead,
        end: vi.fn(),
      } as unknown as http.ServerResponse
      await handleIncomingRequest(mockReq, mockRes, server.authToken, {} as any, new Set())
      expect(writeHead).toHaveBeenCalledWith(404, { 'Content-Type': 'application/json' })
    }
    finally {
      await server.close()
    }
  })
})
