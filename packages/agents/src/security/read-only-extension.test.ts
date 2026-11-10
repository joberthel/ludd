import type { ExtensionAPI, ToolCallEvent } from '@earendil-works/pi-coding-agent'
import { SandboxViolationError } from '@ludd/core'
import { describe, expect, it, vi } from 'vitest'
import { createReadOnlyToolCallHandler, readOnlyExtension } from './read-only-extension.js'

function call(toolName: string, input: Record<string, unknown>): ToolCallEvent {
  return ({
    type: 'tool_call',
    toolCallId: 'c',
    toolName,
    input,
  })
}

describe('read-only tool_call handler', () => {
  const handler = createReadOnlyToolCallHandler('/ludd-nonexistent-ws')

  it.each(['write', 'edit', 'bash'])('rejects %s with SandboxViolationError', (tool) => {
    expect(() => handler(call(tool, {}))).toThrow(SandboxViolationError)
  })

  it('rejects reads of protected run state', () => {
    expect(() => handler(call('read', { path: '.harness/runs/r1/state.json' }))).toThrow(SandboxViolationError)
  })

  it('allows safe reads, pathless calls and MCP tools', () => {
    expect(handler(call('read', { path: 'src/a.ts' }))).toBeUndefined()
    expect(handler(call('ls', {}))).toBeUndefined()
    expect(handler(call('mcp__ludd__put_artifact', { name: 'spec.md' }))).toBeUndefined()
  })

  it('registers the handler on tool_call', () => {
    const on = vi.fn()
    void readOnlyExtension('/w')({ on } as unknown as ExtensionAPI)
    expect(on).toHaveBeenCalledWith('tool_call', expect.any(Function))
  })
})
