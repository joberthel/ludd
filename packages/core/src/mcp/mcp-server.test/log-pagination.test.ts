import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createLogStore } from '../log-store.js'
import { startEmbeddedMcpServer } from '../mcp-server.js'

async function postJson(url: string, token: string, body: unknown): Promise<any> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify(body),
  })
  return res.json()
}

function make250Lines(): string {
  return Array.from({ length: 250 }, (_, i) => {
    const msg = i === 120
      ? 'FAIL: test_something_critical failed'
      : 'PASS: check ok'
    return `Line ${i + 1}: ${msg}`
  }).join('\n')
}

async function verifyPageAndLines(url: string, token: string): Promise<void> {
  const pageRes = await postJson(url, token, {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: {
      name: 'read_log_page',
      arguments: { logKey: 'step-test-1-afterStep-0', page: 2, pageSize: 50 },
    },
  })
  expect(pageRes.result.isError).toBeUndefined()
  const pageData = JSON.parse(pageRes.result.content[0].text)
  expect(pageData.format).toBe('text')
  expect(pageData.page).toBe(2)
  expect(pageData.totalPages).toBe(5)
  expect(pageData.lines).toHaveLength(50)

  const linesRes = await postJson(url, token, {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: {
      name: 'read_log_lines',
      arguments: { logKey: 'step-test-1-afterStep-0', startLine: 120, endLine: 122 },
    },
  })
  const linesData = JSON.parse(linesRes.result.content[0].text)
  expect(linesData.lines).toHaveLength(3)
  expect(linesData.lines[1]).toContain('FAIL: test_something_critical')
}

async function verifySearch(url: string, token: string): Promise<void> {
  const searchRes = await postJson(url, token, {
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: {
      name: 'search_log',
      arguments: { logKey: 'step-test-1-afterStep-0', query: 'critical' },
    },
  })
  const searchData = JSON.parse(searchRes.result.content[0].text)
  expect(searchData.totalMatches).toBe(1)
  expect(searchData.matches[0].lineNumber).toBe(121)
}

describe('embedded MCP server plain-text log tools (AC 5.3.2)', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ludd-mcp-log-page-'))
  })

  afterEach(async () => {
    await fs.promises.rm(tempDir, { recursive: true, force: true })
  })

  it('serves bounded plain-text line ranges and search matches over MCP', async () => {
    const store = createLogStore(tempDir)
    await store.offload({
      stepId: 'step-test',
      attempt: 1,
      phase: 'afterStep',
      guardrailIndex: 0,
      content: make250Lines(),
    })

    const server = await startEmbeddedMcpServer(tempDir, undefined, { logStore: store })
    try {
      await verifyPageAndLines(server.url, server.authToken)
      await verifySearch(server.url, server.authToken)
    }
    finally {
      await server.close()
    }
  })
})

describe('embedded MCP server JSON log tools (AC 5.3.3)', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ludd-mcp-log-json-'))
  })

  afterEach(async () => {
    await fs.promises.rm(tempDir, { recursive: true, force: true })
  })

  it('serves paginated JSON slices with totalItems and totalPages', async () => {
    const store = createLogStore(tempDir)
    const jsonErrors = {
      errors: Array.from({ length: 25 }, (_, i) => ({ code: `ERR_${i + 1}`, message: `Error message ${i + 1}` })),
    }

    await store.offload({
      stepId: 'step-phpstan',
      attempt: 1,
      phase: 'afterStep',
      guardrailIndex: 0,
      content: JSON.stringify(jsonErrors),
      pagination: 'errors',
    })

    const server = await startEmbeddedMcpServer(tempDir, undefined, { logStore: store })
    try {
      const pageRes = await postJson(server.url, server.authToken, {
        jsonrpc: '2.0',
        id: 10,
        method: 'tools/call',
        params: {
          name: 'read_log_page',
          arguments: { logKey: 'step-phpstan-1-afterStep-0', page: 1, pageSize: 10 },
        },
      })
      expect(pageRes.result.isError).toBeUndefined()
      const data = JSON.parse(pageRes.result.content[0].text)
      expect(data.format).toBe('json')
      expect(data.totalItems).toBe(25)
      expect(data.totalPages).toBe(3)
      expect(data.items).toHaveLength(10)
    }
    finally {
      await server.close()
    }
  })
})

describe('embedded MCP server list_artifacts tool', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ludd-mcp-list-art-'))
  })

  afterEach(async () => {
    await fs.promises.rm(tempDir, { recursive: true, force: true })
  })

  it('executes list_artifacts via MCP tools/call', async () => {
    const server = await startEmbeddedMcpServer(tempDir)
    try {
      await postJson(server.url, server.authToken, {
        jsonrpc: '2.0',
        id: 20,
        method: 'tools/call',
        params: {
          name: 'put_artifact',
          arguments: { key: 'doc1.md', content: '# Doc 1' },
        },
      })
      await postJson(server.url, server.authToken, {
        jsonrpc: '2.0',
        id: 21,
        method: 'tools/call',
        params: {
          name: 'put_artifact',
          arguments: { key: 'nested/doc2.md', content: '# Doc 2' },
        },
      })

      const listRes = await postJson(server.url, server.authToken, {
        jsonrpc: '2.0',
        id: 22,
        method: 'tools/call',
        params: {
          name: 'list_artifacts',
          arguments: {},
        },
      })
      expect(listRes.result.isError).toBeUndefined()
      const list = JSON.parse(listRes.result.content[0].text)
      expect(list).toEqual(['doc1.md', 'nested/doc2.md'])
    }
    finally {
      await server.close()
    }
  })
})
