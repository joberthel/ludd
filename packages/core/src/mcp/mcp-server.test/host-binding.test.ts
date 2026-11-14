import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { startEmbeddedMcpServer } from '../mcp-server.js'

describe('startEmbeddedMcpServer host binding', () => {
  const tempDirs: string[] = []

  afterEach(() => {
    for (const dir of tempDirs) {
      fs.rmSync(dir, { recursive: true, force: true })
    }
    tempDirs.length = 0
  })

  function makeTempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ludd-mcp-host-'))
    tempDirs.push(dir)
    return dir
  }

  it('defaults to 127.0.0.1 and returns http://127.0.0.1:<port>/mcp', async () => {
    const server = await startEmbeddedMcpServer(makeTempDir())
    try {
      expect(server.url).toBe(`http://127.0.0.1:${server.port}/mcp`)
      const res = await fetch(server.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${server.authToken}`,
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
      })
      expect(res.status).toBe(200)
    }
    finally {
      await server.close()
    }
  })

  it('binds to 0.0.0.0 when host is 0.0.0.0 while returning http://127.0.0.1:<port>/mcp', async () => {
    const server = await startEmbeddedMcpServer(makeTempDir(), { host: '0.0.0.0' })
    try {
      expect(server.url).toBe(`http://127.0.0.1:${server.port}/mcp`)
      const res = await fetch(server.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${server.authToken}`,
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
      })
      expect(res.status).toBe(200)
    }
    finally {
      await server.close()
    }
  })
})
