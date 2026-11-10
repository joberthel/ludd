import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { piAgent } from '../pi-agent.js'
import { fakeSession, turnInput } from './fake-session.js'

describe('piAgent failure modes', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'ludd-pi-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
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
