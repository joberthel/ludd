import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { startEmbeddedMcpServer } from '../mcp-server.js'

describe('embedded MCP server token resolution', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ludd-mcp-auth-test-'))
  })

  afterEach(async () => {
    await fs.promises.rm(tempDir, { recursive: true, force: true })
  })

  it('generates a 64-char hex auth token when authToken is omitted or whitespace', async () => {
    const server1 = await startEmbeddedMcpServer(tempDir)
    expect(server1.authToken).toHaveLength(64)
    expect(server1.authToken).toMatch(/^[0-9a-f]{64}$/)
    await server1.close()

    const server2 = await startEmbeddedMcpServer(tempDir, '   ')
    expect(server2.authToken).toHaveLength(64)
    await server2.close()
  })

  it('uses custom auth token when provided', async () => {
    const server = await startEmbeddedMcpServer(tempDir, 'custom-secret-token')
    expect(server.authToken).toBe('custom-secret-token')
    await server.close()
  })
})

describe('embedded MCP server header validation', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ludd-mcp-auth-test-'))
  })

  afterEach(async () => {
    await fs.promises.rm(tempDir, { recursive: true, force: true })
  })

  it('returns 401 when Authorization header is missing or non-Bearer', async () => {
    const server = await startEmbeddedMcpServer(tempDir)
    try {
      const res1 = await fetch(server.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      })
      expect(res1.status).toBe(401)

      const res2 = await fetch(server.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${server.authToken}`,
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      })
      expect(res2.status).toBe(401)
    }
    finally {
      await server.close()
    }
  })
})

describe('embedded MCP server token comparison mismatch', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ludd-mcp-auth-test-'))
  })

  afterEach(async () => {
    await fs.promises.rm(tempDir, { recursive: true, force: true })
  })

  it('returns 401 on token length mismatch or byte mismatch', async () => {
    const server = await startEmbeddedMcpServer(tempDir, '0123456789abcdef0123456789abcdef')
    try {
      const resShort = await fetch(server.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer short',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      })
      expect(resShort.status).toBe(401)

      const resWrong = await fetch(server.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer 0123456789abcdef0123456789abcdeg',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      })
      expect(resWrong.status).toBe(401)
    }
    finally {
      await server.close()
    }
  })
})

describe('embedded MCP server successful authorization', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ludd-mcp-auth-test-'))
  })

  afterEach(async () => {
    await fs.promises.rm(tempDir, { recursive: true, force: true })
  })

  it('allows request when valid Bearer token is supplied', async () => {
    const server = await startEmbeddedMcpServer(tempDir)
    try {
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
