import fs from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { createArtifactStore, startEmbeddedMcpServer } from '@luddjs/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { acpAgent } from '../acp-agent.js'
import { buildMcpBridgeServerConfig } from '../acp-mcp.js'
import { CLI_BIN_PATH, FAKE_ACP_SERVER, makeTurnInput } from './helpers.js'

describe('acpAgent MCP stdio bridge wiring', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'ludd-acp-mcp-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('builds stdio MCP server config for explicit mcpBridge, LUDD_CLI_BIN, and default ludd binary', () => {
    const mcp = { url: 'http://127.0.0.1:4321/mcp', authToken: 'secret-token' }

    expect(buildMcpBridgeServerConfig(mcp, {
      command: '/custom/node',
      args: ['/custom/cli.js', 'mcp-bridge'],
    }, {})).toEqual({
      name: 'ludd',
      command: '/custom/node',
      args: [
        '/custom/cli.js',
        'mcp-bridge',
        '--endpoint',
        mcp.url,
      ],
      env: [
        { name: 'LUDD_MCP_TOKEN', value: 'secret-token' },
      ],
    })

    expect(buildMcpBridgeServerConfig(mcp, { command: 'ludd-custom' }, {})).toEqual({
      name: 'ludd',
      command: 'ludd-custom',
      args: ['--endpoint', mcp.url],
      env: [
        { name: 'LUDD_MCP_TOKEN', value: 'secret-token' },
      ],
    })

    expect(buildMcpBridgeServerConfig(mcp, undefined, { LUDD_CLI_BIN: '/path/to/bin.js' })).toEqual({
      name: 'ludd',
      command: process.execPath,
      args: [
        '/path/to/bin.js',
        'mcp-bridge',
        '--endpoint',
        mcp.url,
      ],
      env: [
        { name: 'LUDD_MCP_TOKEN', value: 'secret-token' },
      ],
    })

    expect(buildMcpBridgeServerConfig(mcp, undefined, {})).toEqual({
      name: 'ludd',
      command: 'ludd',
      args: ['mcp-bridge', '--endpoint', mcp.url],
      env: [
        { name: 'LUDD_MCP_TOKEN', value: 'secret-token' },
      ],
    })
  })

  it('wires ludd mcp-bridge over stdio and completes a live MCP tool call against startEmbeddedMcpServer', async () => {
    expect(fs.existsSync(CLI_BIN_PATH)).toBe(true)
    const artifactStore = createArtifactStore(dir)
    const mcpServer = await startEmbeddedMcpServer(dir, { artifactStore })
    try {
      const agent = acpAgent<string>({
        command: process.execPath,
        args: [FAKE_ACP_SERVER],
        env: { FAKE_ACP_SCENARIO: 'mcp-tool' },
        mcpBridge: {
          command: process.execPath,
          args: [CLI_BIN_PATH, 'mcp-bridge'],
        },
      })

      const result = await agent.executeTurn(makeTurnInput(dir, {
        mcp: {
          url: mcpServer.url,
          authToken: mcpServer.authToken,
        },
      }))

      const parsed = JSON.parse(result.output) as { isError?: boolean, content?: Array<{ text?: string }> }
      expect(parsed.isError).not.toBe(true)
      expect(await artifactStore.get('acp-note')).toBe('hello-from-mcp')
    }
    finally {
      await mcpServer.close()
    }
  })
})
