import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startEmbeddedMcpServer } from '../mcp-server.js'

async function postJson(url: string, token: string, body: unknown): Promise<any> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify(body),
  })
  return res.json()
}

describe('embedded MCP server tool path traversal errors', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ludd-mcp-tools-err-'))
  })

  afterEach(async () => {
    await fs.promises.rm(tempDir, { recursive: true, force: true })
  })

  it('returns isError: true on path traversal in put_artifact and get_artifact', async () => {
    const server = await startEmbeddedMcpServer(tempDir)
    try {
      const putData = await postJson(server.url, server.authToken, {
        jsonrpc: '2.0',
        id: 6,
        method: 'tools/call',
        params: {
          name: 'put_artifact',
          arguments: { key: '../escape.txt', content: 'hack' },
        },
      })
      expect(putData.result.isError).toBe(true)
      expect(putData.result.content[0].text).toContain('invalid path segment')

      const getData = await postJson(server.url, server.authToken, {
        jsonrpc: '2.0',
        id: 7,
        method: 'tools/call',
        params: {
          name: 'get_artifact',
          arguments: { key: '/root.txt' },
        },
      })
      expect(getData.result.isError).toBe(true)
      expect(getData.result.content[0].text).toContain('cannot start with a slash')
    }
    finally {
      await server.close()
    }
  })
})

describe('embedded MCP server tool missing and unknown errors', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ludd-mcp-tools-err-'))
  })

  afterEach(async () => {
    await fs.promises.rm(tempDir, { recursive: true, force: true })
  })

  it('returns isError: true on missing artifact in get_artifact', async () => {
    const server = await startEmbeddedMcpServer(tempDir)
    try {
      const data = await postJson(server.url, server.authToken, {
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: {
          name: 'get_artifact',
          arguments: { key: 'nonexistent.md' },
        },
      })
      expect(data.result.isError).toBe(true)
      expect(data.result.content[0].text).toBe('Artifact "nonexistent.md" not found.')
    }
    finally {
      await server.close()
    }
  })

  it('returns isError: true on unknown tool call or missing params', async () => {
    const server = await startEmbeddedMcpServer(tempDir)
    try {
      const data1 = await postJson(server.url, server.authToken, {
        jsonrpc: '2.0',
        id: 8,
        method: 'tools/call',
        params: { name: 'non_existent_tool' },
      })
      expect(data1.result.isError).toBe(true)
      expect(data1.result.content[0].text).toBe('Unknown tool: "non_existent_tool".')

      const data2 = await postJson(server.url, server.authToken, {
        jsonrpc: '2.0',
        id: 9,
        method: 'tools/call',
      })
      expect(data2.result.isError).toBe(true)
    }
    finally {
      await server.close()
    }
  })
})

describe('embedded MCP server executeToolCall fallback error handling', () => {
  it('handles list_artifacts error and missing log store in executeToolCall', async () => {
    const { executeToolCall } = await import('../mcp-tools.js')
    const mockStore: any = {
      list: vi.fn().mockRejectedValue(new Error('disk failed')),
    }
    const resList = await executeToolCall('list_artifacts', {}, mockStore)
    expect(resList.isError).toBe(true)
    expect(resList.content[0].text).toBe('disk failed')

    const mockStoreWithoutList: any = {}
    const resEmpty = await executeToolCall('list_artifacts', {}, mockStoreWithoutList)
    expect(resEmpty.content[0].text).toBe('[]')

    const resNoLogStore = await executeToolCall('read_log_page', {}, mockStore)
    expect(resNoLogStore.isError).toBe(true)
    expect(resNoLogStore.content[0].text).toBe('Log store is not available.')
  })
})
