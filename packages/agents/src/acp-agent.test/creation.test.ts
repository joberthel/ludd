import { isAgentRunner } from '@luddjs/core'
import { describe, expect, it } from 'vitest'
import { acpAgent } from '../acp-agent.js'

describe('acpAgent creation and configuration', () => {
  it('creates an AgentRunner matching isAgentRunner contract with readOnly defaults', () => {
    const agent = acpAgent({ command: 'claude' })
    expect(isAgentRunner(agent)).toBe(true)
    expect(agent.__kind).toBe('agent')
    expect(agent.mode).toBe('read-only')
    expect(agent.prompt).toBe('')
    expect(agent.sessionId).toBeUndefined()
  })

  it('maps permissionMode to AgentAccessMode and preserves prompt/sessionId', () => {
    const readOnlyAgent = acpAgent({
      command: 'codex',
      permissionMode: 'readOnly',
      prompt: 'review code',
      sessionId: 'sess-1',
    })
    expect(readOnlyAgent.mode).toBe('read-only')
    expect(readOnlyAgent.prompt).toBe('review code')
    expect(readOnlyAgent.sessionId).toBe('sess-1')

    const editAgent = acpAgent({
      command: 'claude',
      permissionMode: 'acceptEdits',
      prompt: () => 'dynamic prompt',
    })
    expect(editAgent.mode).toBe('workspace-write')
    expect(typeof editAgent.prompt).toBe('function')

    const bypassAgent = acpAgent({
      command: 'agy',
      permissionMode: 'bypassPermissions',
      mcpBridge: { command: 'custom-ludd' },
    })
    expect(bypassAgent.mode).toBe('workspace-write')
  })

  it('defensively clones args, env, and mcpBridge configuration', () => {
    const args = ['--acp']
    const env = { FOO: 'bar' }
    const mcpBridge = {
      command: 'ludd',
      args: ['mcp-bridge'],
    }

    const agent = acpAgent({
      command: 'claude',
      args,
      env,
      mcpBridge,
    })

    args.push('--mutated')
    env.FOO = 'mutated'
    mcpBridge.args.push('--mutated')

    expect(isAgentRunner(agent)).toBe(true)
  })

  it('rejects invalid command or shutdownTimeoutMs values', () => {
    expect(() => acpAgent({ command: '' })).toThrow('non-empty "command"')
    expect(() => acpAgent({ command: '   ' })).toThrow('non-empty "command"')
    expect(() => acpAgent(null as never)).toThrow('non-empty "command"')
    expect(() => acpAgent({ command: 'claude', shutdownTimeoutMs: 0 })).toThrow('positive finite number')
    expect(() => acpAgent({ command: 'claude', shutdownTimeoutMs: -50 })).toThrow('positive finite number')
    expect(() => acpAgent({ command: 'claude', shutdownTimeoutMs: Number.POSITIVE_INFINITY })).toThrow('positive finite number')
    expect(() => acpAgent({ command: 'claude', shutdownTimeoutMs: '100' as never })).toThrow('positive finite number')
  })
})
