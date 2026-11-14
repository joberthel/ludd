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

const workspaceWriteExtension = vi.fn(() => () => {})
vi.mock('../security/workspace-write-extension.js', () => ({
  workspaceWriteExtension,
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

  it('forwards dangerMode to workspaceWriteExtension', async () => {
    const { defaultPiSessionFactory } = await import('../pi-agent.js')
    await defaultPiSessionFactory({ ...base, mode: 'workspace-write', dangerMode: true })
    expect(workspaceWriteExtension).toHaveBeenCalledWith('/w', { dangerMode: true })
  })

  it('forwards dangerMode from executeTurn to sessionFactory', async () => {
    const { piAgent } = await import('../pi-agent.js')
    let listener: ((event: { type: string }) => void) | undefined
    const factory = vi.fn(async () => ({
      subscribe: (cb: (event: { type: string }) => void) => {
        listener = cb
        return () => {}
      },
      prompt: async () => {
        listener?.({ type: 'agent_settled' })
      },
      abort: async () => {},
      getLastAssistantText: () => 'ok',
    }))
    await piAgent({ prompt: 'p', sessionFactory: factory }).executeTurn({
      stepId: 's',
      sessionId: 'sess',
      runDir: '/r',
      mode: 'workspace-write',
      dangerMode: true,
      prompt: 'p',
      mcpServerUrl: '',
      mcpAuthToken: '',
      environment: { workingDir: '/w' } as never,
      ctx: {} as never,
      attempt: 1,
    })
    expect(factory).toHaveBeenCalledWith(expect.objectContaining({ dangerMode: true }))
  })
})
