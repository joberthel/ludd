import { beforeEach, describe, expect, it, vi } from 'vitest'

const open = vi.fn((..._a: unknown[]) => ({ manager: true }))
const bindExtensions = vi.fn(async (..._a: unknown[]) => {})
const setModel = vi.fn(async (..._a: unknown[]) => {})
const setThinkingLevel = vi.fn()
const dispose = vi.fn()
const modelRuntime = { runtime: true }
const createAgentSession = vi.fn(async (..._a: unknown[]) => ({
  session: {
    s: 1,
    modelRuntime,
    bindExtensions,
    setModel,
    setThinkingLevel,
    dispose,
  },
}))
const reload = vi.fn(async () => {})
const resolveCliModel = vi.fn()

class FakeLoader {
  reload = reload
}

vi.mock('@earendil-works/pi-coding-agent', () => ({
  SessionManager: { open },
  createAgentSession,
  DefaultResourceLoader: FakeLoader,
  getAgentDir: () => '/agent',
  resolveCliModel,
  createBashToolDefinition: (cwd: string, opts: unknown) => ({ name: 'bash', cwd, opts }),
}))

const base = { cwd: '/w', sessionFile: '/r/pi-sessions/a.jsonl' }

describe('defaultPiSessionFactory string model resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('resolves a string model after binding extensions and applies model and thinkingLevel', async () => {
    const resolvedModel = { id: 'gemini-4-hydrogen', provider: 'antigravity' }
    resolveCliModel.mockReturnValue({
      model: resolvedModel,
      thinkingLevel: 'high',
      warning: undefined,
      error: undefined,
    })
    const { defaultPiSessionFactory } = await import('../pi-agent.js')
    await defaultPiSessionFactory({ ...base, mode: 'read-only', model: 'gemini-4-hydrogen:high' })
    expect(createAgentSession.mock.calls[0]?.[0]).not.toHaveProperty('model')
    expect(bindExtensions).toHaveBeenCalledOnce()
    expect(resolveCliModel).toHaveBeenCalledWith({ cliModel: 'gemini-4-hydrogen:high', modelRuntime })
    expect(setModel).toHaveBeenCalledWith(resolvedModel)
    expect(setThinkingLevel).toHaveBeenCalledWith('high')
  })

  it('omits setThinkingLevel when resolveCliModel returns no thinking level', async () => {
    const resolvedModel = { id: 'gemini-4-hydrogen', provider: 'antigravity' }
    resolveCliModel.mockReturnValue({
      model: resolvedModel,
      thinkingLevel: undefined,
      warning: undefined,
      error: undefined,
    })
    const { defaultPiSessionFactory } = await import('../pi-agent.js')
    await defaultPiSessionFactory({ ...base, mode: 'read-only', model: 'gemini-4-hydrogen' })
    expect(setModel).toHaveBeenCalledWith(resolvedModel)
    expect(setThinkingLevel).not.toHaveBeenCalled()
  })

  it('disposes the session and throws when resolveCliModel reports an error', async () => {
    resolveCliModel.mockReturnValue({ model: undefined, warning: undefined, error: 'Model "bad-model" not found.' })
    const { defaultPiSessionFactory } = await import('../pi-agent.js')
    await expect(defaultPiSessionFactory({ ...base, mode: 'read-only', model: 'bad-model' }))
      .rejects
      .toThrow('Model "bad-model" not found.')
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('falls back to a default error when resolveCliModel returns neither model nor error', async () => {
    resolveCliModel.mockReturnValue({ model: undefined, warning: undefined, error: undefined })
    const { defaultPiSessionFactory } = await import('../pi-agent.js')
    await expect(defaultPiSessionFactory({ ...base, mode: 'read-only', model: 'missing-model' }))
      .rejects
      .toThrow('Unknown Pi model: missing-model')
    expect(dispose).toHaveBeenCalledOnce()
  })
})
