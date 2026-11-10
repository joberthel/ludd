import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { piAgent } from '../pi-agent.js'
import { fakeSession } from './fake-session.js'

describe('piAgent config defaults', () => {
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
})
