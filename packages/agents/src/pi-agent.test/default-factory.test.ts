import { beforeEach, describe, expect, it, vi } from 'vitest'

const open = vi.fn((..._a: unknown[]) => ({ manager: true }))
const createAgentSession = vi.fn(async (..._a: unknown[]) => ({
  session: { s: 1 },
}))
vi.mock('@earendil-works/pi-coding-agent', () => ({
  SessionManager: { open },
  createAgentSession,
}))

describe('defaultPiSessionFactory', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('opens the session file and creates a Pi SDK session in the environment cwd', async () => {
    const { defaultPiSessionFactory } = await import('../pi-agent.js')
    const session = await defaultPiSessionFactory({ cwd: '/w', sessionFile: '/r/pi-sessions/a.jsonl', mode: 'read-only' })
    expect(open).toHaveBeenCalledWith('/r/pi-sessions/a.jsonl', '/r/pi-sessions', '/w')
    expect(createAgentSession).toHaveBeenCalledWith({
      cwd: '/w',
      sessionManager: { manager: true },
    })
    expect(session).toEqual({ s: 1 })
  })

  it('forwards an explicit model', async () => {
    const { defaultPiSessionFactory } = await import('../pi-agent.js')
    await defaultPiSessionFactory({
      cwd: '/w',
      sessionFile: '/r/pi-sessions/a.jsonl',
      mode: 'read-only',
      model: { id: 'm' },
    })
    expect(createAgentSession).toHaveBeenCalledWith({
      cwd: '/w',
      sessionManager: { manager: true },
      model: { id: 'm' },
    })
  })
})
