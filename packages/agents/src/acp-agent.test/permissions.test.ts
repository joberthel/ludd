import type { RequestPermissionRequest, ToolKind } from '@agentclientprotocol/sdk'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { acpAgent } from '../acp-agent.js'
import { handlePermissionRequest } from '../acp-permissions.js'
import { FAKE_ACP_SERVER, makeTurnInput } from './helpers.js'

const ALL_OPTIONS: RequestPermissionRequest['options'] = [
  { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
  { optionId: 'allow-always', name: 'Allow always', kind: 'allow_always' },
  { optionId: 'reject-once', name: 'Reject once', kind: 'reject_once' },
  { optionId: 'reject-always', name: 'Reject always', kind: 'reject_always' },
]

function makePermissionReq(kind?: ToolKind | null): RequestPermissionRequest {
  return {
    sessionId: 's-1',
    toolCall: {
      toolCallId: 'tc-1',
      title: 'Tool call',
      kind,
    },
    options: ALL_OPTIONS,
  }
}

describe('acpAgent permission delegation', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'ludd-acp-perm-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('evaluates readOnly, acceptEdits, and bypassPermissions across tool kinds', () => {
    for (const kind of ['read', 'search', 'fetch', 'think'] as const) {
      expect(handlePermissionRequest('readOnly', makePermissionReq(kind))).toEqual({
        outcome: { outcome: 'selected', optionId: 'allow-once' },
      })
    }
    for (const kind of [
      'edit',
      'delete',
      'move',
      'execute',
      'switch_mode',
      'other',
      undefined,
      null,
    ] as const) {
      expect(handlePermissionRequest('readOnly', makePermissionReq(kind))).toEqual({
        outcome: { outcome: 'selected', optionId: 'reject-once' },
      })
    }

    for (const kind of ['read', 'edit', 'move', 'delete'] as const) {
      expect(handlePermissionRequest('acceptEdits', makePermissionReq(kind))).toEqual({
        outcome: { outcome: 'selected', optionId: 'allow-once' },
      })
    }
    for (const kind of [
      'execute',
      'switch_mode',
      'other',
      undefined,
    ] as const) {
      expect(handlePermissionRequest('acceptEdits', makePermissionReq(kind))).toEqual({
        outcome: { outcome: 'selected', optionId: 'reject-once' },
      })
    }

    for (const kind of ['execute', 'edit', undefined] as const) {
      expect(handlePermissionRequest('bypassPermissions', makePermissionReq(kind))).toEqual({
        outcome: { outcome: 'selected', optionId: 'allow-once' },
      })
    }
  })

  it('falls back to allow_always/reject_always or cancelled when options are missing', () => {
    const alwaysOnly: RequestPermissionRequest = {
      sessionId: 's-1',
      toolCall: { toolCallId: 'tc-1', kind: 'read' },
      options: [
        { optionId: 'allow-always', name: 'Allow always', kind: 'allow_always' },
        { optionId: 'reject-always', name: 'Reject always', kind: 'reject_always' },
      ],
    }
    expect(handlePermissionRequest('readOnly', alwaysOnly)).toEqual({
      outcome: { outcome: 'selected', optionId: 'allow-always' },
    })
    expect(handlePermissionRequest('readOnly', {
      ...alwaysOnly,
      toolCall: { toolCallId: 'tc-2', kind: 'execute' },
    })).toEqual({
      outcome: { outcome: 'selected', optionId: 'reject-always' },
    })
    expect(handlePermissionRequest('readOnly', {
      ...alwaysOnly,
      options: [],
    })).toEqual({
      outcome: { outcome: 'cancelled' },
    })
  })

  it('delegates live session/request_permission over ACP stdio for readOnly, acceptEdits, and bypassPermissions', async () => {
    const runPermissionScenario = async (
      permissionMode: 'readOnly' | 'acceptEdits' | 'bypassPermissions',
      kind: string,
    ) => {
      const agent = acpAgent<string>({
        command: process.execPath,
        args: [FAKE_ACP_SERVER],
        permissionMode,
        env: {
          FAKE_ACP_SCENARIO: 'permission',
          FAKE_ACP_PERMISSION_KIND: kind,
        },
      })
      const res = await agent.executeTurn(makeTurnInput(dir))
      return JSON.parse(res.output) as { outcome: string, optionId?: string }
    }

    expect(await runPermissionScenario('readOnly', 'edit')).toEqual({
      outcome: 'selected',
      optionId: 'reject-once',
    })
    expect(await runPermissionScenario('acceptEdits', 'edit')).toEqual({
      outcome: 'selected',
      optionId: 'allow-once',
    })
    expect(await runPermissionScenario('acceptEdits', 'execute')).toEqual({
      outcome: 'selected',
      optionId: 'reject-once',
    })
    expect(await runPermissionScenario('bypassPermissions', 'execute')).toEqual({
      outcome: 'selected',
      optionId: 'allow-once',
    })
  })
})
