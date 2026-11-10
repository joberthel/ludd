import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { piAgent } from '../pi-agent.js'
import { fakeSession, turnInput } from './fake-session.js'
import { scriptedEvents } from './scripted-events.js'

describe('piAgent output and streaming', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'ludd-pi-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('returns output and sessionId and passes session options (AC 1)', async () => {
    let seen: unknown
    const session = fakeSession(scriptedEvents(), 'final answer')
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
      environment: expect.objectContaining({ type: 'host', workingDir: '/work' }),
    })
  })
})
