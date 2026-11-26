import type {
  AgentRunner,
  DynamicProperty,
  StepContext,
} from '@luddjs/core'
import type { AcpMcpBridgeConfig } from './acp-mcp.js'
import type { AcpPermissionMode } from './acp-permissions.js'
import { resolveAgentAccessMode } from './acp-permissions.js'
import { DEFAULT_SHUTDOWN_TIMEOUT_MS, executeAcpTurn } from './acp-process.js'

export type { AcpMcpBridgeConfig, AcpStdioMcpServerConfig } from './acp-mcp.js'
export type { AcpPermissionMode } from './acp-permissions.js'

export interface AcpAgentConfig<
  TContext extends StepContext<any, any, any, any> = StepContext<any, any, any, any>,
> {
  /** Executable binary or command (e.g., `'claude'`, `'codex'`, `'agy'`). */
  command: string
  /** CLI arguments to start the agent in ACP mode (e.g., `['--acp']`). */
  args?: string[]
  /** Additional environment variables merged into the spawned ACP subprocess. */
  env?: Record<string, string>
  /** Permission mode forwarded to ACP `session/request_permission` handling. Defaults to `'readOnly'`. */
  permissionMode?: AcpPermissionMode
  /** Timeout in milliseconds for graceful ACP cancel and subprocess exit cleanup. Defaults to `5000`. */
  shutdownTimeoutMs?: number
  /** Step prompt template or resolver. Defaults to `''`. */
  prompt?: DynamicProperty<string, TContext>
  /** Optional dynamic or static session identifier. */
  sessionId?: DynamicProperty<string | undefined, TContext>
  /** Optional override for the `ludd mcp-bridge` command used when `input.mcp` is provided. */
  mcpBridge?: AcpMcpBridgeConfig
}

function validateConfig(config: AcpAgentConfig<any>): {
  command: string
  shutdownTimeoutMs: number
  permissionMode: AcpPermissionMode
} {
  if (typeof config?.command !== 'string' || config.command.trim() === '') {
    throw new Error('acpAgent requires a non-empty "command" string.')
  }
  const shutdownTimeoutMs = config.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS
  if (typeof shutdownTimeoutMs !== 'number' || !Number.isFinite(shutdownTimeoutMs) || shutdownTimeoutMs <= 0) {
    throw new Error('acpAgent "shutdownTimeoutMs" must be a positive finite number.')
  }
  const permissionMode = config.permissionMode ?? 'readOnly'
  return {
    command: config.command.trim(),
    shutdownTimeoutMs,
    permissionMode,
  }
}

function cloneMcpBridge(mcpBridge?: AcpMcpBridgeConfig): AcpMcpBridgeConfig | undefined {
  if (mcpBridge === undefined) {
    return undefined
  }
  return {
    command: mcpBridge.command,
    args: mcpBridge.args
      ? [...mcpBridge.args]
      : undefined,
  }
}

/**
 * Creates a production `AgentRunner` backed by an external ACP-compatible CLI subprocess over `stdio`.
 */
export function acpAgent<
  TOutput = unknown,
  TContext extends StepContext<any, any, any, any> = StepContext<any, any, any, any>,
>(config: AcpAgentConfig<TContext>): AgentRunner<TOutput, TContext> {
  const { command, shutdownTimeoutMs, permissionMode } = validateConfig(config)
  const args = config.args
    ? [...config.args]
    : []
  const env = config.env
    ? { ...config.env }
    : {}
  const mcpBridge = cloneMcpBridge(config.mcpBridge)

  return {
    __kind: 'agent',
    mode: resolveAgentAccessMode(permissionMode),
    prompt: config.prompt ?? '',
    sessionId: config.sessionId,
    executeTurn: async input => executeAcpTurn<TOutput>({
      command,
      args,
      env,
      permissionMode,
      shutdownTimeoutMs,
      mcpBridge,
    }, input),
  }
}
