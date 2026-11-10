import type { ExtensionFactory, ToolCallEvent, ToolCallEventResult } from '@earendil-works/pi-coding-agent'
import { SandboxViolationError } from '@ludd/core'
import { BRIDGE_TOOL_NAMES } from '../mcp/pi-mcp-tools.js'
import { assertSafeWorkspacePath } from './workspace-path-guard.js'

/** Tools physically removed from read-only sessions via `excludeTools`. */
export const READ_ONLY_EXCLUDED_TOOLS = ['write', 'edit', 'bash']

/**
 * `tool_call` handler for read-only sessions: mutating tools are rejected
 * (defence in depth next to `excludeTools`) and any `path` argument must pass
 * the workspace path guard. Bridge tools (MCP + `submit_step_output`) are exempt because their
 * arguments are not filesystem paths even when a schema field is named `path`.
 */
export function createReadOnlyToolCallHandler(workspaceRoot: string) {
  return (event: ToolCallEvent): ToolCallEventResult | undefined => {
    if (READ_ONLY_EXCLUDED_TOOLS.includes(event.toolName)) {
      throw new SandboxViolationError(event.toolName, `tool is unavailable in read-only mode`)
    }
    if (BRIDGE_TOOL_NAMES.includes(event.toolName)) {
      return undefined
    }
    const target = (event.input as { path?: unknown }).path
    if (typeof target === 'string') {
      assertSafeWorkspacePath(target, workspaceRoot)
    }
    return undefined
  }
}

export function readOnlyExtension(workspaceRoot: string): ExtensionFactory {
  const handler = createReadOnlyToolCallHandler(workspaceRoot)
  return (pi) => {
    pi.on('tool_call', handler)
  }
}
