import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { piAgent } from '../pi-agent.js'
import { fakeSession, turnInput } from './fake-session.js'

describe('piAgent settle semantics', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'ludd-pi-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
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
})
