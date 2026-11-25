import { beforeEach, describe, expect, it, vi } from 'vitest'

const open = vi.fn((..._a: unknown[]) => ({ manager: true }))
const bindExtensions = vi.fn(async (..._a: unknown[]) => {})
const createAgentSession = vi.fn(async (..._a: unknown[]) => ({
  session: { s: 1, bindExtensions },
}))
const reload = vi.fn(async () => {})
const loaderCtor = vi.fn()
class FakeLoader {
  reload = reload
  constructor(...args: unknown[]) {
    loaderCtor(...args)
  }
}
vi.mock('@earendil-works/pi-coding-agent', () => ({
  SessionManager: { open },
  createAgentSession,
  DefaultResourceLoader: FakeLoader,
  getAgentDir: () => '/agent',
  createBashToolDefinition: (cwd: string, opts: unknown) => ({ name: 'bash', cwd, opts }),
}))

const base = { cwd: '/w', sessionFile: '/r/pi-sessions/a.jsonl' }

describe('defaultPiSessionFactory host bash delegation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('overrides bash via customTools with host spawn in workspace-write mode', async () => {
    const { defaultPiSessionFactory } = await import('../pi-agent.js')
    const signal = new AbortController().signal
    await defaultPiSessionFactory({
      ...base,
      mode: 'workspace-write',
      env: { FOO: 'bar' },
      signal,
    })
    expect(createAgentSession).toHaveBeenCalledWith(expect.objectContaining({
      customTools: [
        expect.objectContaining({ name: 'bash', cwd: '/w' }),
      ],
    }))
  })

  it('omits the custom bash tool in read-only mode', async () => {
    const { defaultPiSessionFactory } = await import('../pi-agent.js')
    await defaultPiSessionFactory({
      ...base,
      mode: 'read-only',
      env: { FOO: 'bar' },
    })
    expect(createAgentSession.mock.calls[0]?.[0]).not.toHaveProperty('customTools')
  })

  it('merges bridge customTools after the host bash override and keeps them in read-only mode', async () => {
    const { defaultPiSessionFactory } = await import('../pi-agent.js')
    const bridge = { name: 'put_artifact' } as never
    await defaultPiSessionFactory({
      ...base,
      mode: 'workspace-write',
      env: { A: '1' },
      customTools: [bridge],
    })
    expect(createAgentSession.mock.calls[0]?.[0]).toMatchObject({
      customTools: [
        expect.objectContaining({ name: 'bash' }),
        bridge,
      ],
    })
    await defaultPiSessionFactory({
      ...base,
      mode: 'read-only',
      customTools: [bridge],
    })
    expect(createAgentSession.mock.calls[1]?.[0]).toMatchObject({
      customTools: [bridge],
    })
  })
})
