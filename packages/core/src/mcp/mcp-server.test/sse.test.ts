import type { Buffer } from 'node:buffer'
import type * as http from 'node:http'
import fs from 'node:fs'
import nodeHttp from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startEmbeddedMcpServer } from '../mcp-server.js'

describe('embedded MCP server SSE handshake', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ludd-mcp-sse-test-'))
  })

  afterEach(async () => {
    await fs.promises.rm(tempDir, { recursive: true, force: true })
  })

  it('performs SSE handshake on GET /sse with endpoint event', async () => {
    const server = await startEmbeddedMcpServer(tempDir)
    try {
      const sseUrl = `http://127.0.0.1:${server.port}/sse`
      const client = await new Promise<{ status: number, headers: nodeHttp.IncomingHttpHeaders, data: string }>((resolve, reject) => {
        const req = nodeHttp.get(sseUrl, {
          headers: { Authorization: `Bearer ${server.authToken}` },
        }, (res) => {
          let data = ''
          res.on('data', (chunk: Buffer) => {
            data += chunk.toString('utf8')
            if (data.includes('event: endpoint\ndata: /mcp\n\n')) {
              req.destroy()
              resolve({ status: res.statusCode ?? 0, headers: res.headers, data })
            }
          })
        })
        req.on('error', (err) => {
          if ((err as NodeJS.ErrnoException).code !== 'ECONNRESET') {
            reject(err)
          }
        })
      })

      expect(client.status).toBe(200)
      expect(client.headers['content-type']).toBe('text/event-stream')
      expect(client.headers['cache-control']).toBe('no-cache')
      expect(client.headers.connection).toBe('keep-alive')
      expect(client.data).toContain('event: endpoint\ndata: /mcp\n\n')
    }
    finally {
      await server.close()
    }
  })
})

describe('embedded MCP server SSE connection shutdown', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ludd-mcp-sse-test-'))
  })

  afterEach(async () => {
    await fs.promises.rm(tempDir, { recursive: true, force: true })
  })

  it('closes all open SSE connections when server is closed', async () => {
    const server = await startEmbeddedMcpServer(tempDir)
    const sseUrl = `http://127.0.0.1:${server.port}/sse`

    let sseEnded = false
    let clientRes: http.IncomingMessage | undefined
    await new Promise<void>((resolve, reject) => {
      const req = nodeHttp.get(sseUrl, {
        headers: { Authorization: `Bearer ${server.authToken}` },
      }, (res) => {
        clientRes = res
        res.on('data', () => {
          resolve()
        })
      })
      req.on('error', reject)
    })

    const endedPromise = new Promise<void>((resolve) => {
      clientRes?.on('end', () => {
        sseEnded = true
        resolve()
      })
    })

    await server.close()
    await endedPromise
    expect(sseEnded).toBe(true)
  })
})

describe('embedded MCP server SSE lifecycle and disconnect handling', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ludd-mcp-sse-test-'))
  })

  afterEach(async () => {
    await fs.promises.rm(tempDir, { recursive: true, force: true })
  })

  it('handles client disconnecting from SSE and multiple close calls safely', async () => {
    const server = await startEmbeddedMcpServer(tempDir)
    const sseUrl = `http://127.0.0.1:${server.port}/sse`
    await new Promise<void>((resolve, reject) => {
      const req = nodeHttp.get(sseUrl, {
        headers: { Authorization: `Bearer ${server.authToken}` },
      }, (res) => {
        res.on('data', () => {
          req.destroy()
          resolve()
        })
      })
      req.on('error', (err) => {
        if ((err as NodeJS.ErrnoException).code === 'ECONNRESET') {
          resolve()
        }
        else {
          reject(err)
        }
      })
    })

    await server.close()
    await expect(server.close()).resolves.toBeUndefined()
  })

  it('propagates unexpected errors when server.close fails', async () => {
    const server = await startEmbeddedMcpServer(tempDir)
    const closeSpy = vi.spyOn(nodeHttp.Server.prototype, 'close').mockImplementationOnce((cb) => {
      cb?.(new Error('EIO: socket close error'))
      return nodeHttp.Server.prototype
    })

    await expect(server.close()).rejects.toThrow('EIO: socket close error')
    closeSpy.mockRestore()
    await server.close()
  })
})
