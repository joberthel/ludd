import type { McpServerStdio } from '@agentclientprotocol/sdk'
import type { AgentMcpConnection } from '@luddjs/core'
import process from 'node:process'

export interface AcpStdioMcpServerConfig {
  name: 'ludd'
  command: string
  args: string[]
  env?: Array<{ name: string, value: string }>
}

export interface AcpMcpBridgeConfig {
  command: string
  args?: string[]
}

/** Builds the ACP `stdio` MCP server config pointing at `ludd mcp-bridge` for the active embedded MCP server. */
export function buildMcpBridgeServerConfig(
  mcp: AgentMcpConnection,
  bridgeConfig?: AcpMcpBridgeConfig,
  env: NodeJS.ProcessEnv = process.env,
): McpServerStdio {
  const mcpEnv = [
    { name: 'LUDD_MCP_TOKEN', value: mcp.authToken },
  ]
  if (bridgeConfig !== undefined) {
    return {
      name: 'ludd',
      command: bridgeConfig.command,
      args: [
        ...(bridgeConfig.args ?? []),
        '--endpoint',
        mcp.url,
      ],
      env: mcpEnv,
    }
  }

  const cliBin = env.LUDD_CLI_BIN?.trim()
  if (cliBin !== undefined && cliBin !== '') {
    return {
      name: 'ludd',
      command: process.execPath,
      args: [
        cliBin,
        'mcp-bridge',
        '--endpoint',
        mcp.url,
      ],
      env: mcpEnv,
    }
  }

  return {
    name: 'ludd',
    command: 'ludd',
    args: ['mcp-bridge', '--endpoint', mcp.url],
    env: mcpEnv,
  }
}
