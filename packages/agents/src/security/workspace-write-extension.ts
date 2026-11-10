import type { ExtensionFactory, ToolCallEvent, ToolCallEventResult } from '@earendil-works/pi-coding-agent'
import { SandboxViolationError } from '@ludd/core'
import { assertSafeWorkspacePath } from './workspace-path-guard.js'

/** Tools whose `path` argument is routed through the workspace path guard. */
const PATH_TOOLS = ['read', 'write', 'edit']

const PROTECTED_BASH_PATTERNS = [/\.harness\/runs(?:\/|\b)/, /\.git\/hooks(?:\/|\b)/]

/**
 * `tool_call` handler for workspace-write sessions (ADR-0009 Layer 1).
 *
 * File tools go through `assertSafeWorkspacePath` (symlink-safe). `bash`
 * commands mentioning `.harness/runs/` or `.git/hooks/` are rejected, but this
 * string matching is BEST-EFFORT ONLY (trivially bypassed via variables,
 * globbing or encoding). The container boundary (ADR-0009 Layer 2) is the real
 * control for shell access.
 */
export function createWorkspaceWriteToolCallHandler(workspaceRoot: string, options: { dangerMode?: boolean } = {}) {
  return (event: ToolCallEvent): ToolCallEventResult | undefined => {
    const input = event.input as { path?: unknown, command?: unknown }
    if (PATH_TOOLS.includes(event.toolName) && typeof input.path === 'string') {
      assertSafeWorkspacePath(input.path, workspaceRoot, options)
    }
    if (event.toolName === 'bash' && typeof input.command === 'string') {
      const command = input.command
      if (PROTECTED_BASH_PATTERNS.some(pattern => pattern.test(command))) {
        throw new SandboxViolationError('bash', 'command references a protected directory (.harness/runs, .git/hooks)')
      }
    }
    return undefined
  }
}

export function workspaceWriteExtension(workspaceRoot: string, options: { dangerMode?: boolean } = {}): ExtensionFactory {
  const handler = createWorkspaceWriteToolCallHandler(workspaceRoot, options)
  return (pi) => {
    pi.on('tool_call', handler)
  }
}
