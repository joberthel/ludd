import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { readStreamEvents } from '@ludd/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { piAgent } from '../pi-agent.js'
import { fakeSession, turnInput } from './fake-session.js'

describe('piAgent executeTurn', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'ludd-pi-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('defaults to read-only mode and keeps config fields', () => {
    const agent = piAgent({
      prompt: 'p',
      sessionFactory: async () => fakeSession([]),
    })
    expect(agent.mode).toBe('read-only')
    expect(agent.__kind).toBe('agent')
    expect(piAgent({ mode: 'workspace-write', prompt: 'p' }).mode).toBe('workspace-write')
  })

  it('returns output and sessionId and streams live events (AC 1)', async () => {
    let seen: unknown
    const session = fakeSession([
      {
        type: 'message_update',
        assistantMessageEvent: { type: 'thinking_delta', delta: 'hm' },
      },
      {
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', delta: 'hi' },
      },
      {
        type: 'message_update',
        assistantMessageEvent: { type: 'text_start' },
      },
      { type: 'message_update' },
      {
        type: 'tool_execution_start',
        toolCallId: 't1',
        toolName: 'read',
        args: { p: 1 },
      },
      {
        type: 'tool_execution_update',
        toolCallId: 't1',
        toolName: 'read',
        partialResult: 'x',
      },
      {
        type: 'tool_execution_end',
        toolCallId: 't1',
        toolName: 'read',
        result: 'r',
        isError: false,
      },
      { type: 'turn_end' },
      { type: 'agent_settled', aborted: false },
    ], 'final answer')
    const agent = piAgent({
      prompt: 'p',
      model: { id: 'm' },
      sessionFactory: async (o) => {
        seen = o
        return session
      },
    })

    const result = await agent.executeTurn(turnInput(dir))

    expect(result).toEqual({ output: 'final answer', sessionId: 'sess-1' })
    expect(session.prompts).toEqual(['hello'])
    expect(seen).toEqual({
      cwd: '/work',
      sessionFile: path.join(dir, 'pi-sessions', 'sess-1.jsonl'),
      mode: 'read-only',
      model: { id: 'm' },
    })
    const events = readStreamEvents(dir, 'sess-1')
    expect(events.map(e => e.eventType)).toEqual([
      'thought',
      'message_chunk',
      'tool_call',
      'tool_call',
      'tool_call',
    ])
    expect(events[1]?.payload).toEqual({ text: 'hi' })
    expect(events.map(e => e.payload.phase)).toEqual([
      undefined,
      undefined,
      'start',
      'update',
      'end',
    ])
    expect(events[0]?.runId).toBe('run-1')
  })

  it('waits for agent_settled before resolving', async () => {
    const session = fakeSession([])
    const listeners: Array<(e: { type: string }) => void> = []
    session.subscribe = (l) => {
      listeners.push(l)
      return () => {}
    }
    const fire = () => listeners.forEach(l => l({ type: 'agent_settled' }))
    let done = false
    const p = piAgent({
      prompt: 'p',
      sessionFactory: async () => session,
    })
      .executeTurn(turnInput(dir))
      .then(() => {
        done = true
      })
    await new Promise(r => setTimeout(r, 20))
    expect(done).toBe(false)
    fire()
    await p
    expect(done).toBe(true)
  })

  it('returns empty output when the assistant produced no text', async () => {
    const session = fakeSession([
      { type: 'agent_settled' },
    ], null)
    const r = await piAgent({
      prompt: 'p',
      sessionFactory: async () => session,
    }).executeTurn(turnInput(dir))
    expect(r.output).toBe('')
  })

  it('propagates prompt failures', async () => {
    const session = fakeSession([])
    session.prompt = async () => {
      throw new Error('llm down')
    }
    await expect(piAgent({
      prompt: 'p',
      sessionFactory: async () => session,
    }).executeTurn(turnInput(dir)))
      .rejects
      .toThrow('llm down')
  })
})
