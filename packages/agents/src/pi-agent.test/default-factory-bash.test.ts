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

describe('defaultPiSessionFactory docker bash delegation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('overrides bash via customTools for docker-worktree environments', async () => {
    const { defaultPiSessionFactory } = await import('../pi-agent.js')
    const environment = { type: 'docker-worktree', workingDir: '/w' } as never
    await defaultPiSessionFactory({ ...base, mode: 'workspace-write', environment })
    expect(createAgentSession).toHaveBeenCalledWith(expect.objectContaining({
      customTools: [
        expect.objectContaining({ name: 'bash', cwd: '/w' }),
      ],
    }))
  })

  it('keeps the default bash for non-docker environments', async () => {
    const { defaultPiSessionFactory } = await import('../pi-agent.js')
    const environment = { type: 'host', workingDir: '/w' } as never
    await defaultPiSessionFactory({ ...base, mode: 'workspace-write', environment })
    expect(createAgentSession.mock.calls[0]?.[0]).not.toHaveProperty('customTools')
  })

  it('merges bridge customTools after the docker bash override and keeps them in read-only mode', async () => {
    const { defaultPiSessionFactory } = await import('../pi-agent.js')
    const bridge = { name: 'put_artifact' } as never
    const environment = { type: 'docker-worktree', workingDir: '/w' } as never
    await defaultPiSessionFactory({
      ...base,
      mode: 'workspace-write',
      environment,
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
      environment,
      customTools: [bridge],
    })
    expect(createAgentSession.mock.calls[1]?.[0]).toMatchObject({
      customTools: [bridge],
    })
  })
})
