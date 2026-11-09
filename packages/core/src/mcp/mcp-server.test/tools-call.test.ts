import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { startEmbeddedMcpServer } from '../mcp-server.js'

async function postJson(url: string, token: string, body: unknown): Promise<any> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify(body),
  })
  return res.json()
}

describe('embedded MCP server tool execution roundtrip', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ludd-mcp-tools-call-'))
  })

  afterEach(async () => {
    await fs.promises.rm(tempDir, { recursive: true, force: true })
  })

  it('executes put_artifact successfully and retrieves via get_artifact', async () => {
    const server = await startEmbeddedMcpServer(tempDir)
    try {
      const putData = await postJson(server.url, server.authToken, {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'put_artifact',
          arguments: { key: 'notes/todos.txt', content: '- todo item 1\n- todo item 2' },
        },
      })
      expect(putData.result.isError).toBeUndefined()
      expect(putData.result.content[0].text).toContain('stored successfully')

      const getData = await postJson(server.url, server.authToken, {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'get_artifact',
          arguments: { key: 'notes/todos.txt' },
        },
      })
      expect(getData.result.isError).toBeUndefined()
      expect(getData.result.content[0].text).toBe('- todo item 1\n- todo item 2')
    }
    finally {
      await server.close()
    }
  })
})

describe('embedded MCP server tool argument validation', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ludd-mcp-tools-call-'))
  })

  afterEach(async () => {
    await fs.promises.rm(tempDir, { recursive: true, force: true })
  })

  it('returns isError: true on invalid arguments for put_artifact and get_artifact', async () => {
    const server = await startEmbeddedMcpServer(tempDir)
    try {
      const invalidPuts = [
        {},
        { key: 123, content: 'test' },
        { key: 'key.txt', content: 123 },
      ]
      for (const args of invalidPuts) {
        const data = await postJson(server.url, server.authToken, {
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: { name: 'put_artifact', arguments: args },
        })
        expect(data.result.isError).toBe(true)
        expect(data.result.content[0].text).toContain('Invalid arguments')
      }

      const invalidGetData = await postJson(server.url, server.authToken, {
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: {
          name: 'get_artifact',
          arguments: { key: 999 },
        },
      })
      expect(invalidGetData.result.isError).toBe(true)
    }
    finally {
      await server.close()
    }
  })
})
