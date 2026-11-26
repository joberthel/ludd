import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import { createLogStore, startEmbeddedMcpServer } from '@luddjs/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runMcpBridge } from '../mcp-bridge-command.js'

function createJsonRpcReader(stream: PassThrough) {
  const messages: Array<Record<string, unknown>> = []
  let buffer = ''
  stream.setEncoding('utf8')
  stream.on('data', (chunk: string) => {
    buffer += chunk
    let idx = buffer.indexOf('\n')
    while (idx !== -1) {
      const line = buffer.slice(0, idx)
      buffer = buffer.slice(idx + 1)
      messages.push(JSON.parse(line) as Record<string, unknown>)
      idx = buffer.indexOf('\n')
    }
  })

  return {
    messages,
    waitForId: async (id: number | string, timeoutMs = 5000): Promise<Record<string, unknown>> => {
      const deadline = Date.now() + timeoutMs
      while (Date.now() < deadline) {
        const found = messages.find(m => m.id === id)
        if (found)
          return found
        await new Promise(resolve => setTimeout(resolve, 10))
      }
      throw new Error(`Timed out waiting for JSON-RPC response id=${String(id)}`)
    },
  }
}

describe('mcp-bridge live embedded MCP server integration', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ludd-mcp-bridge-live-'))
  })

  afterEach(async () => {
    await fs.promises.rm(tempDir, { recursive: true, force: true })
  })

  it('proxies initialize, notifications, tools/list, artifacts, paginated logs, and blocking ask_user concurrently', async () => {
    const logStore = createLogStore(tempDir)
    const logMeta = await logStore.offload({
      stepId: 'build',
      attempt: 1,
      phase: 'afterStep',
      guardrailIndex: 0,
      content: 'alpha line\nbeta error line\ngamma line\ndelta error line',
    })

    const server = await startEmbeddedMcpServer(tempDir, { logStore })
    let resolveAskUser!: (answer: string) => void
    let markAskUserStarted!: () => void
    const askUserStarted = new Promise<void>((resolve) => {
      markAskUserStarted = resolve
    })
    let receivedPrompt = ''
    server.setAskUserHandler?.(async (question) => {
      receivedPrompt = question.prompt
      return new Promise<string>((resolve) => {
        resolveAskUser = resolve
        markAskUserStarted()
      })
    })

    const stdin = new PassThrough()
    const stdout = new PassThrough()
    const stderr = new PassThrough()
    let stderrOutput = ''
    stderr.setEncoding('utf8').on('data', (chunk: string) => {
      stderrOutput += chunk
    })
    const reader = createJsonRpcReader(stdout)

    const bridgePromise = runMcpBridge({
      endpoint: server.url,
      token: server.authToken,
      stdin,
      stdout,
      stderr,
      registerSignalHandlers: false,
    })

    try {
      const send = (msg: Record<string, unknown>): void => {
        stdin.write(`${JSON.stringify(msg)}\n`)
      }

      send({ jsonrpc: '2.0', id: 1, method: 'initialize' })
      const initRes = await reader.waitForId(1)
      expect((initRes.result as Record<string, unknown>).protocolVersion).toBe('2024-11-05')

      send({ jsonrpc: '2.0', method: 'notifications/initialized' })
      send({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
      const listRes = await reader.waitForId(2)
      const toolNames = ((listRes.result as { tools: Array<{ name: string }> }).tools).map(t => t.name)
      expect(toolNames).toContain('put_artifact')
      expect(toolNames).toContain('read_log_page')
      expect(toolNames).toContain('ask_user')

      send({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'put_artifact',
          arguments: { key: 'plan.md', content: '# Plan' },
        },
      })
      expect(await reader.waitForId(3)).toMatchObject({
        result: {
          content: [
            { text: 'Artifact "plan.md" stored successfully.' },
          ],
        },
      })

      send({
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: {
          name: 'get_artifact',
          arguments: { key: 'plan.md' },
        },
      })
      expect(await reader.waitForId(4)).toMatchObject({
        result: {
          content: [
            { text: '# Plan' },
          ],
        },
      })

      send({
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: { name: 'list_artifacts', arguments: {} },
      })
      const artifactsRes = await reader.waitForId(5)
      expect(JSON.parse((artifactsRes.result as { content: Array<{ text: string }> }).content[0].text)).toEqual(['plan.md'])

      send({
        jsonrpc: '2.0',
        id: 6,
        method: 'tools/call',
        params: {
          name: 'read_log_page',
          arguments: { logKey: logMeta.logKey, page: 1, pageSize: 2 },
        },
      })
      const pageRes = await reader.waitForId(6)
      expect(JSON.parse((pageRes.result as { content: Array<{ text: string }> }).content[0].text)).toMatchObject({
        page: 1,
        totalLines: 4,
        totalPages: 2,
      })

      send({
        jsonrpc: '2.0',
        id: 7,
        method: 'tools/call',
        params: {
          name: 'read_log_lines',
          arguments: { logKey: logMeta.logKey, startLine: 2, endLine: 3 },
        },
      })
      const linesRes = await reader.waitForId(7)
      expect(JSON.parse((linesRes.result as { content: Array<{ text: string }> }).content[0].text)).toMatchObject({
        lines: ['beta error line', 'gamma line'],
      })

      send({
        jsonrpc: '2.0',
        id: 8,
        method: 'tools/call',
        params: {
          name: 'search_log',
          arguments: { logKey: logMeta.logKey, query: 'error' },
        },
      })
      const searchRes = await reader.waitForId(8)
      expect(JSON.parse((searchRes.result as { content: Array<{ text: string }> }).content[0].text)).toMatchObject({
        matches: [
          { lineNumber: 2, text: 'beta error line' },
          { lineNumber: 4, text: 'delta error line' },
        ],
      })

      // Blocking ask_user call while concurrent ping still responds immediately
      send({
        jsonrpc: '2.0',
        id: 9,
        method: 'tools/call',
        params: {
          name: 'ask_user',
          arguments: { type: 'text', prompt: 'Deploy to prod?' },
        },
      })
      send({ jsonrpc: '2.0', id: 10, method: 'ping' })
      expect(await reader.waitForId(10)).toEqual({ jsonrpc: '2.0', id: 10, result: {} })
      expect(reader.messages.find(m => m.id === 9)).toBeUndefined()

      await askUserStarted
      expect(receivedPrompt).toBe('Deploy to prod?')
      resolveAskUser('approved')
      expect(await reader.waitForId(9)).toMatchObject({
        result: {
          content: [
            { text: 'approved' },
          ],
        },
      })

      stdin.end()
      expect(await bridgePromise).toBe(0)
      expect(stderrOutput).toBe('')
    }
    finally {
      await server.close()
    }
  })

  it('rejects invalid bearer tokens with HTTP 401 JSON-RPC error and stderr diagnostic', async () => {
    const server = await startEmbeddedMcpServer(tempDir, 'correct-secret')
    const stdin = new PassThrough()
    const stdout = new PassThrough()
    const stderr = new PassThrough()
    let stderrOutput = ''
    stderr.setEncoding('utf8').on('data', (chunk: string) => {
      stderrOutput += chunk
    })
    const reader = createJsonRpcReader(stdout)

    const bridgePromise = runMcpBridge({
      endpoint: server.url,
      token: 'wrong-secret',
      stdin,
      stdout,
      stderr,
      registerSignalHandlers: false,
    })

    try {
      stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 'auth-1', method: 'tools/list' })}\n`)
      stdin.end()

      const res = await reader.waitForId('auth-1')
      expect(res).toMatchObject({
        jsonrpc: '2.0',
        id: 'auth-1',
        error: {
          code: -32000,
          message: expect.stringContaining('401'),
        },
      })
      expect(await bridgePromise).toBe(0)
      expect(stderrOutput).toContain('Upstream HTTP 401')
    }
    finally {
      await server.close()
    }
  })
})
