import type { ToolDefinition } from '@earendil-works/pi-coding-agent'
import type { AgentAccessMode, ProvisionedEnvironment } from '@ludd/core'

/**
 * Minimal structural view of a Pi SDK `AgentSessionEvent`. Only the fields the
 * adapter consumes are described so tests can script sessions without the SDK.
 */
export interface PiSessionEvent {
  type: string
  assistantMessageEvent?: { type: string, delta?: string }
  toolCallId?: string
  toolName?: string
  args?: unknown
  partialResult?: unknown
  result?: unknown
  isError?: boolean
  aborted?: boolean
}

/** Minimal subset of the Pi SDK `AgentSession` used by `piAgent`. */
export interface PiSession {
  subscribe: (listener: (event: PiSessionEvent) => void) => () => void
  prompt: (text: string) => Promise<void>
  abort: () => Promise<void>
  getLastAssistantText: () => string | undefined
  dispose?: () => void
}

export interface PiSessionFactoryOptions {
  /** Working directory of the provisioned environment. */
  cwd: string
  /** Absolute path of the JSONL session file (`<runDir>/pi-sessions/<sessionId>.jsonl`). Resumed when present. */
  sessionFile: string
  mode: AgentAccessMode
  /** Provisioned environment; `docker-worktree` environments receive a container-delegating `bash` tool. */
  environment?: ProvisionedEnvironment
  /** Opaque Pi SDK model object, forwarded to `createAgentSession`. */
  model?: unknown
  /** Extra Pi `customTools` (MCP bridge, `submit_step_output`), available in every mode. */
  customTools?: ToolDefinition[]
}

/** Injectable factory so unit tests never hit a real LLM. */
export type PiSessionFactory = (options: PiSessionFactoryOptions) => Promise<PiSession>
