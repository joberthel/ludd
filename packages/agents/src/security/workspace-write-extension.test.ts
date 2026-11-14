import type { ExtensionAPI, ToolCallEvent } from '@earendil-works/pi-coding-agent'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { SandboxViolationError } from '@ludd/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createWorkspaceWriteToolCallHandler, workspaceWriteExtension } from './workspace-write-extension.js'

function call(toolName: string, input: Record<string, unknown>): ToolCallEvent {
  return {
    type: 'tool_call',
    toolCallId: 'c',
    toolName,
    input,
  }
}

describe('workspace-write tool_call handler', () => {
  let root: string
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ludd-ww-'))
    fs.mkdirSync(path.join(root, '.git', 'hooks'), { recursive: true })
    fs.symlinkSync(path.join(root, '.git', 'hooks'), path.join(root, 'link'))
  })
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  it.each(['read', 'write', 'edit'])('rejects %s of protected paths, direct or symlinked', (tool) => {
    const handler = createWorkspaceWriteToolCallHandler(root)
    expect(() => handler(call(tool, { path: '.harness/runs/r1/state.json' }))).toThrow(SandboxViolationError)
    expect(() => handler(call(tool, { path: '.git/hooks/pre-commit' }))).toThrow(SandboxViolationError)
    expect(() => handler(call(tool, { path: 'link/pre-commit' }))).toThrow(SandboxViolationError)
  })

  it('allows normal in-workspace writes and unrelated tools', () => {
    const handler = createWorkspaceWriteToolCallHandler(root)
    expect(handler(call('write', { path: 'src/a.ts', content: 'x' }))).toBeUndefined()
    expect(handler(call('write', {}))).toBeUndefined()
    expect(handler(call('mcp__x', { path: '.git/hooks/x' }))).toBeUndefined()
  })

  it('rejects workspace escapes unless dangerMode', () => {
    expect(() => createWorkspaceWriteToolCallHandler(root)(call('write', { path: '/etc/passwd' }))).toThrow(SandboxViolationError)
    expect(createWorkspaceWriteToolCallHandler(root, { dangerMode: true })(call('write', { path: '/etc/passwd' }))).toBeUndefined()
  })

  it('rejects bash commands referencing protected directories (best effort)', () => {
    const handler = createWorkspaceWriteToolCallHandler(root)
    expect(() => handler(call('bash', { command: 'cat .harness/runs/r1/state.json' }))).toThrow(SandboxViolationError)
    expect(() => handler(call('bash', { command: 'echo x > .git/hooks/pre-commit' }))).toThrow(SandboxViolationError)
    expect(handler(call('bash', { command: 'ls src' }))).toBeUndefined()
    expect(handler(call('bash', {}))).toBeUndefined()
  })

  it('registers the handler on tool_call', async () => {
    const on = vi.fn()
    await workspaceWriteExtension(root)({ on } as unknown as ExtensionAPI)
    expect(on).toHaveBeenCalledWith('tool_call', expect.any(Function))
  })

  it('normalizes containerWorkingDir-prefixed paths on tool_call input', () => {
    const handler = createWorkspaceWriteToolCallHandler(root, { containerWorkingDir: '/workspace' })
    const event = call('read', { path: '/workspace/src/a.ts' })
    expect(handler(event)).toBeUndefined()
    expect((event.input as { path: string }).path).toBe('src/a.ts')
  })
})
