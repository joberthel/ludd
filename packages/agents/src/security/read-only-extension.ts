import type { ExtensionFactory, ToolCallEvent, ToolCallEventResult } from '@earendil-works/pi-coding-agent'
import { SandboxViolationError } from '@ludd/core'
import { BRIDGE_TOOL_NAMES } from '../mcp/pi-mcp-tools.js'
import { assertSafeWorkspacePath, normalizeContainerPath } from './workspace-path-guard.js'

/** Tools physically removed from read-only sessions via `excludeTools`. */
export const READ_ONLY_EXCLUDED_TOOLS = ['write', 'edit', 'bash']

/**
 * `tool_call` handler for read-only sessions: mutating tools are rejected
 * (defence in depth next to `excludeTools`) and any `path` argument must pass
 * the workspace path guard. Bridge tools (MCP + `submit_step_output`) are exempt because their
 * arguments are not filesystem paths even when a schema field is named `path`.
 */
export interface ReadOnlyExtensionOptions {
  containerWorkingDir?: string
}

export function createReadOnlyToolCallHandler(workspaceRoot: string, options: ReadOnlyExtensionOptions = {}) {
  return (event: ToolCallEvent): ToolCallEventResult | undefined => {
    if (READ_ONLY_EXCLUDED_TOOLS.includes(event.toolName)) {
      throw new SandboxViolationError(event.toolName, `tool is unavailable in read-only mode`)
    }
    if (BRIDGE_TOOL_NAMES.includes(event.toolName)) {
      return undefined
    }
    const input = event.input as { path?: unknown }
    if (typeof input.path === 'string') {
      assertSafeWorkspacePath(input.path, workspaceRoot, options)
      const normalized = normalizeContainerPath(input.path, options.containerWorkingDir)
      if (normalized !== input.path) {
        input.path = normalized
      }
    }
    return undefined
  }
}

export function readOnlyExtension(workspaceRoot: string, options: ReadOnlyExtensionOptions = {}): ExtensionFactory {
  const handler = createReadOnlyToolCallHandler(workspaceRoot, options)
  return (pi) => {
    pi.on('tool_call', handler)
  }
}
