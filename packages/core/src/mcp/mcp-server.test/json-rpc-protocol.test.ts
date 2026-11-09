import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { startEmbeddedMcpServer } from '../mcp-server.js'

async function postRaw(url: string, token: string, body: string): Promise<any> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body,
  })
  return res.json()
}

describe('embedded MCP server JSON-RPC parse error handling', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ludd-mcp-rpc-proto-'))
  })

  afterEach(async () => {
    await fs.promises.rm(tempDir, { recursive: true, force: true })
  })

  it('returns -32700 Parse error on malformed JSON', async () => {
    const server = await startEmbeddedMcpServer(tempDir)
    try {
      const data = await postRaw(server.url, server.authToken, 'invalid-json{')
      expect(data).toEqual({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: 'Parse error' },
      })
    }
    finally {
      await server.close()
    }
  })
})

describe('embedded MCP server JSON-RPC invalid request handling', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ludd-mcp-rpc-proto-'))
  })

  afterEach(async () => {
    await fs.promises.rm(tempDir, { recursive: true, force: true })
  })

  it('returns -32600 Invalid Request on malformed JSON-RPC structure', async () => {
    const server = await startEmbeddedMcpServer(tempDir)
    try {
      const payloads = [
        [],
        'not-an-object',
        { method: 'test' },
        { jsonrpc: '1.0', method: 'test', id: 2 },
        { jsonrpc: '2.0', id: 3 },
      ]
      for (const payload of payloads) {
        const data = await postRaw(server.url, server.authToken, JSON.stringify(payload))
        expect(data.error.code).toBe(-32600)
      }
    }
    finally {
      await server.close()
    }
  })
})

describe('embedded MCP server notifications and unknown methods', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ludd-mcp-rpc-proto-'))
  })

  afterEach(async () => {
    await fs.promises.rm(tempDir, { recursive: true, force: true })
  })

  it('returns 204 No Content for notifications without id', async () => {
    const server = await startEmbeddedMcpServer(tempDir)
    try {
      const res = await fetch(server.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${server.authToken}` },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
      })
      expect(res.status).toBe(204)
    }
    finally {
      await server.close()
    }
  })

  it('returns -32601 Method not found for unknown methods', async () => {
    const server = await startEmbeddedMcpServer(tempDir)
    try {
      const data = await postRaw(server.url, server.authToken, JSON.stringify({
        jsonrpc: '2.0',
        id: 'req-404',
        method: 'non_existent_method',
      }))
      expect(data).toEqual({
        jsonrpc: '2.0',
        id: 'req-404',
        error: { code: -32601, message: 'Method not found' },
      })
    }
    finally {
      await server.close()
    }
  })
})

describe('embedded MCP server initialize and tools/list discovery', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ludd-mcp-rpc-proto-'))
  })

  afterEach(async () => {
    await fs.promises.rm(tempDir, { recursive: true, force: true })
  })

  it('handles initialize and tools/list standard requests', async () => {
    const server = await startEmbeddedMcpServer(tempDir)
    try {
      const initData = await postRaw(server.url, server.authToken, JSON.stringify({
        jsonrpc: '2.0',
        id: 10,
        method: 'initialize',
      }))
      expect(initData.result.capabilities).toEqual({ tools: {} })
      expect(initData.result.serverInfo.name).toBe('ludd-harness-mcp')

      const listData = await postRaw(server.url, server.authToken, JSON.stringify({
        jsonrpc: '2.0',
        id: 11,
        method: 'tools/list',
      }))
      expect(listData.result.tools).toHaveLength(6)
      expect(listData.result.tools.map((t: any) => t.name)).toEqual([
        'put_artifact',
        'get_artifact',
        'list_artifacts',
        'read_log_page',
        'read_log_lines',
        'search_log',
      ])
    }
    finally {
      await server.close()
    }
  })
})
