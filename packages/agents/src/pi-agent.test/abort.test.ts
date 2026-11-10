import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { piAgent } from '../pi-agent.js'
import { fakeSession, turnInput } from './fake-session.js'

describe('piAgent abort handling (AC 3)', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'ludd-pi-abort-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('calls session.abort() when the signal fires mid-turn and ends cleanly', async () => {
    const session = fakeSession([])
    const controller = new AbortController()
    session.prompt = async () => {
      controller.abort('stop')
      throw new Error('aborted by user')
    }
    const r = await piAgent({
      prompt: 'p',
      sessionFactory: async () => session,
    })
      .executeTurn(turnInput(dir, { signal: controller.signal }))
    expect(session.aborts).toBe(1)
    expect(r.sessionId).toBe('sess-1')
  })

  it('aborts immediately without prompting when already aborted', async () => {
    const session = fakeSession([])
    const r = await piAgent({
      prompt: 'p',
      sessionFactory: async () => session,
    })
      .executeTurn(turnInput(dir, {
        signal: AbortSignal.abort(),
      }))
    expect(session.aborts).toBe(1)
    expect(session.prompts).toEqual([])
    expect(r.output).toBe('done')
  })

  it('does not hang if session.abort() rejects', async () => {
    const session = fakeSession([])
    session.abort = async () => {
      throw new Error('boom')
    }
    await expect(piAgent({
      prompt: 'p',
      sessionFactory: async () => session,
    })
      .executeTurn(turnInput(dir, {
        signal: AbortSignal.abort(),
      }))).resolves.toBeDefined()
  })
})
