import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { createLogStore, startEmbeddedMcpServer } from '@luddjs/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cli, launch, until } from './cli-test-helpers.js'

function spawnBridgeProcess(args: string[], extraEnv: Record<string, string> = {}) {
  const { NODE_V8_COVERAGE: _, ...baseEnv } = process.env
  const child = spawn(process.execPath, [cli, 'mcp-bridge', ...args], {
    env: {
      ...baseEnv,
      ...extraEnv,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  const stdoutLines: string[] = []
  const parsedMessages: Array<Record<string, unknown>> = []
  let stdoutBuffer = ''
  let stderr = ''

  child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
    stdoutBuffer += chunk
    let idx = stdoutBuffer.indexOf('\n')
    while (idx !== -1) {
      const line = stdoutBuffer.slice(0, idx)
      stdoutBuffer = stdoutBuffer.slice(idx + 1)
      stdoutLines.push(line)
      parsedMessages.push(JSON.parse(line) as Record<string, unknown>)
      idx = stdoutBuffer.indexOf('\n')
    }
  })

  child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
    stderr += chunk
  })

  const send = (payload: Record<string, unknown>): void => {
    child.stdin.write(`${JSON.stringify(payload)}\n`)
  }

  const waitForId = async (id: number | string, timeoutMs = 10_000): Promise<Record<string, unknown>> => {
    await until(
      () => parsedMessages.some(msg => msg.id === id) || child.exitCode !== null,
      timeoutMs,
      `Waiting for id=${String(id)}; stdout=${stdoutLines.join('\n')}; stderr=${stderr}`,
    )
    const found = parsedMessages.find(msg => msg.id === id)
    expect(found).toBeDefined()
    return found!
  }

  const waitForExit = async (): Promise<number | null> => {
    if (child.exitCode !== null)
      return child.exitCode
    return new Promise<number | null>(resolve => child.once('close', resolve))
  }

  return {
    child,
    send,
    waitForId,
    waitForExit,
    stdoutLines,
    parsedMessages,
    getStderr: () => stderr,
    getRemainingStdoutBuffer: () => stdoutBuffer,
  }
}

describe('ludd mcp-bridge CLI subprocess e2e', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ludd-mcp-bridge-e2e-'))
  })

  afterEach(async () => {
    await fs.promises.rm(tempDir, { recursive: true, force: true })
  })

  it('fails with stderr-only message and zero stdout on invalid arguments', async () => {
    const result = await launch([
      'mcp-bridge',
      '--endpoint',
      'not-a-url',
      '--token',
      'abc',
    ], tempDir)
    expect(result.code).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('Invalid MCP endpoint URL')
  })

  it('proxies full MCP lifecycle, artifacts, paginated logs, and blocking ask_user over stdio with pure JSON-RPC stdout', async () => {
    const logStore = createLogStore(tempDir)
    const logMeta = await logStore.offload({
      stepId: 'run',
      attempt: 1,
      phase: 'afterStep',
      guardrailIndex: 0,
      content: 'line-1 ok\nline-2 warn\nline-3 ok',
    })

    const server = await startEmbeddedMcpServer(tempDir, { logStore })
    let resolveAskUser!: (answer: string) => void
    server.setAskUserHandler?.(async () => new Promise<string>((resolve) => {
      resolveAskUser = resolve
    }))

    const bridge = spawnBridgeProcess(['--endpoint', server.url], { LUDD_MCP_TOKEN: server.authToken })

    try {
      bridge.send({ jsonrpc: '2.0', id: 1, method: 'initialize' })
      const init = await bridge.waitForId(1)
      expect((init.result as Record<string, unknown>).serverInfo).toEqual({
        name: 'ludd-harness-mcp',
        version: '1.0.0',
      })

      bridge.send({ jsonrpc: '2.0', method: 'notifications/initialized' })
      bridge.send({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
      const list = await bridge.waitForId(2)
      const names = ((list.result as { tools: Array<{ name: string }> }).tools).map(t => t.name)
      expect(names).toEqual(expect.arrayContaining([
        'put_artifact',
        'get_artifact',
        'list_artifacts',
        'read_log_page',
        'read_log_lines',
        'search_log',
        'ask_user',
      ]))

      bridge.send({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'put_artifact',
          arguments: { key: 'summary.txt', content: 'hello world' },
        },
      })
      await bridge.waitForId(3)
      bridge.send({
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: {
          name: 'get_artifact',
          arguments: { key: 'summary.txt' },
        },
      })
      expect(await bridge.waitForId(4)).toMatchObject({
        result: {
          content: [
            { text: 'hello world' },
          ],
        },
      })

      bridge.send({
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: {
          name: 'read_log_page',
          arguments: { logKey: logMeta.logKey, page: 1, pageSize: 2 },
        },
      })
      const logPage = await bridge.waitForId(5)
      expect(JSON.parse((logPage.result as { content: Array<{ text: string }> }).content[0].text)).toMatchObject({
        totalLines: 3,
        totalPages: 2,
      })

      bridge.send({
        jsonrpc: '2.0',
        id: 6,
        method: 'tools/call',
        params: {
          name: 'search_log',
          arguments: { logKey: logMeta.logKey, query: 'warn' },
        },
      })
      const searchRes = await bridge.waitForId(6)
      expect(JSON.parse((searchRes.result as { content: Array<{ text: string }> }).content[0].text)).toMatchObject({
        matches: [
          { lineNumber: 2, text: 'line-2 warn' },
        ],
      })

      bridge.send({
        jsonrpc: '2.0',
        id: 7,
        method: 'tools/call',
        params: {
          name: 'ask_user',
          arguments: { type: 'confirm', prompt: 'Proceed?' },
        },
      })
      bridge.send({ jsonrpc: '2.0', id: 8, method: 'ping' })
      expect(await bridge.waitForId(8)).toEqual({ jsonrpc: '2.0', id: 8, result: {} })
      expect(bridge.parsedMessages.find(m => m.id === 7)).toBeUndefined()

      await until(() => typeof resolveAskUser === 'function', 5_000)
      resolveAskUser('true')
      expect(await bridge.waitForId(7)).toMatchObject({
        result: {
          content: [
            { text: 'true' },
          ],
        },
      })

      bridge.child.stdin.end()
      expect(await bridge.waitForExit()).toBe(0)
      expect(bridge.getStderr()).toBe('')
      expect(bridge.getRemainingStdoutBuffer()).toBe('')
      for (const line of bridge.stdoutLines) {
        const parsed = JSON.parse(line) as Record<string, unknown>
        expect(parsed.jsonrpc).toBe('2.0')
      }
    }
    finally {
      bridge.child.kill('SIGTERM')
      await server.close()
    }
  })

  it('reports 401 auth failure and exits cleanly on SIGTERM', async () => {
    const server = await startEmbeddedMcpServer(tempDir, 'valid-token')
    const bridge = spawnBridgeProcess([
      '--endpoint',
      server.url,
      '--token',
      'invalid-token',
    ])

    try {
      bridge.send({ jsonrpc: '2.0', id: 'unauth', method: 'tools/list' })
      const errRes = await bridge.waitForId('unauth')
      expect(errRes).toMatchObject({
        jsonrpc: '2.0',
        id: 'unauth',
        error: {
          code: -32000,
          message: expect.stringContaining('401'),
        },
      })

      bridge.child.kill('SIGTERM')
      const exitCode = await bridge.waitForExit()
      expect(exitCode).toBe(0)
      expect(bridge.getStderr()).toContain('Upstream HTTP 401')
      expect(bridge.getStderr()).toContain('Received SIGTERM, shutting down.')
    }
    finally {
      await server.close()
    }
  })
})
