import type { ToolDefinition } from '@earendil-works/pi-coding-agent'
import type { AgentAccessMode } from '@luddjs/core'

/**
 * Minimal structural view of a Pi SDK `AgentSessionEvent`. Only the fields the
 * adapter consumes are described so tests can script sessions without the SDK.
 */
export interface PiSessionEvent {
  type: string
  assistantMessageEvent?: { type: string, delta?: string }
  message?: { role?: string, stopReason?: string, errorMessage?: string }
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
  /** Working directory for the agent session. */
  cwd: string
  /** Absolute path of the JSONL session file (`<runDir>/pi-sessions/<sessionId>.jsonl`). Resumed when present. */
  sessionFile: string
  mode: AgentAccessMode
  /** Allow paths outside the workspace root (intended for isolated containers). */
  dangerMode?: boolean
  /** Environment variables forwarded to host tools (such as `bash`). */
  env?: Record<string, string>
  /** Abort signal forwarded to host tools and session execution. */
  signal?: AbortSignal
  /** Opaque Pi SDK model object or model pattern string, resolved and forwarded to `createAgentSession`. */
  model?: unknown
  /** Extra Pi `customTools` (MCP bridge, `submit_step_output`), available in every mode. */
  customTools?: ToolDefinition[]
}

/** Injectable factory so unit tests never hit a real LLM. */
export type PiSessionFactory = (options: PiSessionFactoryOptions) => Promise<PiSession>
