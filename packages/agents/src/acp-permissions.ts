import type {
  PermissionOption,
  RequestPermissionRequest,
  RequestPermissionResponse,
  ToolKind,
} from '@agentclientprotocol/sdk'
import type { AgentAccessMode } from '@luddjs/core'

export type AcpPermissionMode = 'readOnly' | 'acceptEdits' | 'bypassPermissions'

const READ_ONLY_TOOL_KINDS = new Set<ToolKind>(['read', 'search', 'fetch', 'think'])
const ACCEPT_EDITS_TOOL_KINDS = new Set<ToolKind>([
  'read',
  'search',
  'fetch',
  'think',
  'edit',
  'move',
  'delete',
])

/** Maps an ACP permission mode to the harness `AgentAccessMode`. */
export function resolveAgentAccessMode(permissionMode: AcpPermissionMode = 'readOnly'): AgentAccessMode {
  return permissionMode === 'readOnly'
    ? 'read-only'
    : 'workspace-write'
}

function isToolKindAllowed(permissionMode: AcpPermissionMode, kind: ToolKind | null | undefined): boolean {
  if (permissionMode === 'bypassPermissions') {
    return true
  }
  if (kind === undefined || kind === null) {
    return false
  }
  if (permissionMode === 'acceptEdits') {
    return ACCEPT_EDITS_TOOL_KINDS.has(kind)
  }
  return READ_ONLY_TOOL_KINDS.has(kind)
}

function findAllowOption(options: readonly PermissionOption[]): PermissionOption | undefined {
  return options.find(opt => opt.kind === 'allow_once')
    ?? options.find(opt => opt.kind === 'allow_always')
}

function findRejectOption(options: readonly PermissionOption[]): PermissionOption | undefined {
  return options.find(opt => opt.kind === 'reject_once')
    ?? options.find(opt => opt.kind === 'reject_always')
}

/** Evaluates an ACP `session/request_permission` request against the configured `AcpPermissionMode`. */
export function handlePermissionRequest(
  permissionMode: AcpPermissionMode,
  request: RequestPermissionRequest,
): RequestPermissionResponse {
  const allowed = isToolKindAllowed(permissionMode, request.toolCall.kind)
  const selected = allowed
    ? findAllowOption(request.options)
    : findRejectOption(request.options)

  if (selected === undefined) {
    return {
      outcome: { outcome: 'cancelled' },
    }
  }
  return {
    outcome: {
      outcome: 'selected',
      optionId: selected.optionId,
    },
  }
}
