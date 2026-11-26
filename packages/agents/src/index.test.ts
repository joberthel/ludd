import type {
  AcpAgentConfig,
  AcpMcpBridgeConfig,
  AcpPermissionMode,
  AcpStdioMcpServerConfig,
  AgentMcpConnection,
  AgentStreamEvent,
  AgentStreamEventType,
} from './index.js'
import { describe, expect, it } from 'vitest'
import * as agents from './index.js'

describe('@luddjs/agents public exports', () => {
  it('exports acpAgent, mockAgent factories and stream utilities', () => {
    expect(typeof agents.acpAgent).toBe('function')
    expect(typeof agents.mockAgent).toBe('function')
    expect(typeof agents.appendStreamEvent).toBe('function')
    expect(typeof agents.readStreamEvents).toBe('function')
    expect(typeof agents.resolveStreamPath).toBe('function')
  })

  it('exposes ACP, stream, and MCP connection type contracts', () => {
    const permissionMode: AcpPermissionMode = 'acceptEdits'
    const mcpBridge: AcpMcpBridgeConfig = {
      command: 'node',
      args: ['cli.js'],
    }
    const acpConfig: AcpAgentConfig = {
      command: 'fake-acp',
      permissionMode,
      mcpBridge,
    }
    const stdioMcp: AcpStdioMcpServerConfig = {
      name: 'ludd',
      command: 'ludd',
      args: ['mcp-bridge', '--endpoint', 'http://127.0.0.1:4000/mcp'],
      env: [
        { name: 'LUDD_MCP_TOKEN', value: 'secret' },
      ],
    }
    const mcp: AgentMcpConnection = {
      url: 'http://127.0.0.1:4000/mcp',
      authToken: 'secret',
    }
    const streamType: AgentStreamEventType = 'thought'
    const streamEvent: AgentStreamEvent = {
      schemaVersion: 1,
      timestamp: new Date().toISOString(),
      runId: 'r-1',
      stepId: 's-1',
      sessionId: 'sess-1',
      attempt: 1,
      eventType: streamType,
      payload: { note: 'planning' },
    }

    expect(acpConfig.permissionMode).toBe('acceptEdits')
    expect(stdioMcp.name).toBe('ludd')
    expect(mcp.url).toBe('http://127.0.0.1:4000/mcp')
    expect(streamEvent.eventType).toBe('thought')
    expect(streamEvent.schemaVersion).toBe(1)
  })
})
