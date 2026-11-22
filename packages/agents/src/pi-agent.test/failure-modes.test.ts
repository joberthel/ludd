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

  it('throws the provider error when the assistant message ends with stopReason error', async () => {
    const session = fakeSession([
      {
        type: 'message_end',
        message: {
          role: 'assistant',
          stopReason: 'error',
          errorMessage: 'Codex error: unsupported model',
        },
      },
      { type: 'agent_settled' },
    ], null)
    await expect(piAgent({
      prompt: 'p',
      sessionFactory: async () => session,
    }).executeTurn(turnInput(dir)))
      .rejects
      .toThrow('Codex error: unsupported model')
  })

  it('falls back to a default message when an assistant error omits errorMessage', async () => {
    const session = fakeSession([
      {
        type: 'message_end',
        message: {
          role: 'assistant',
          stopReason: 'error',
          errorMessage: '   ',
        },
      },
      { type: 'agent_settled' },
    ], null)
    await expect(piAgent({
      prompt: 'p',
      sessionFactory: async () => session,
    }).executeTurn(turnInput(dir)))
      .rejects
      .toThrow('Pi agent turn failed with an unknown error.')
  })

  it('clears a prior assistant error when a subsequent retry succeeds', async () => {
    const session = fakeSession([
      {
        type: 'message_end',
        message: {
          role: 'assistant',
          stopReason: 'error',
          errorMessage: 'transient 429',
        },
      },
      {
        type: 'message_end',
        message: {
          role: 'assistant',
          stopReason: 'stop',
        },
      },
      { type: 'agent_settled' },
    ], 'recovered')
    const r = await piAgent({
      prompt: 'p',
      sessionFactory: async () => session,
    }).executeTurn(turnInput(dir))
    expect(r.output).toBe('recovered')
  })
})
