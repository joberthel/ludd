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

describe('defaultPiSessionFactory', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('installs the workspace-write guard extension in workspace-write mode', async () => {
    const { defaultPiSessionFactory } = await import('../pi-agent.js')
    const session = await defaultPiSessionFactory({ ...base, mode: 'workspace-write' })
    expect(open).toHaveBeenCalledWith('/r/pi-sessions/a.jsonl', '/r/pi-sessions', '/w')
    expect(createAgentSession).toHaveBeenCalledWith({
      cwd: '/w',
      sessionManager: { manager: true },
      resourceLoader: expect.any(FakeLoader),
    })
    expect(reload).toHaveBeenCalledOnce()
    expect(bindExtensions).toHaveBeenCalledWith({})
    expect(session).toMatchObject({ s: 1 })
  })

  it('forwards an explicit model', async () => {
    const { defaultPiSessionFactory } = await import('../pi-agent.js')
    await defaultPiSessionFactory({
      ...base,
      mode: 'workspace-write',
      model: { id: 'm' },
    })
    expect(createAgentSession).toHaveBeenCalledWith({
      cwd: '/w',
      sessionManager: { manager: true },
      resourceLoader: expect.any(FakeLoader),
      model: { id: 'm' },
    })
  })

  it('excludes mutating tools and installs the guard extension in read-only mode', async () => {
    const { defaultPiSessionFactory } = await import('../pi-agent.js')
    await defaultPiSessionFactory({ ...base, mode: 'read-only' })
    expect(loaderCtor).toHaveBeenCalledWith(expect.objectContaining({ cwd: '/w', agentDir: '/agent' }))
    expect(reload).toHaveBeenCalledOnce()
    expect(createAgentSession).toHaveBeenCalledWith(expect.objectContaining({
      excludeTools: ['write', 'edit', 'bash'],
      resourceLoader: expect.any(FakeLoader),
    }))
    expect(bindExtensions).toHaveBeenCalledWith({})
  })
})
