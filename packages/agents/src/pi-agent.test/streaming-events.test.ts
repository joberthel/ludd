import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { readStreamEvents } from '@ludd/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { piAgent } from '../pi-agent.js'
import { fakeSession, turnInput } from './fake-session.js'
import { scriptedEvents } from './scripted-events.js'

describe('piAgent live event streaming', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'ludd-pi-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('streams live events (AC 1)', async () => {
    const agent = piAgent({
      prompt: 'p',
      sessionFactory: async () => fakeSession(scriptedEvents(), 'final answer'),
    })

    await agent.executeTurn(turnInput(dir))

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
})
