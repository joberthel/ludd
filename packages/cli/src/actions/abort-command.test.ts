import { createControlClient } from '@ludd/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { abortCommand } from './abort-command.js'

const client = {
  abort: vi.fn(async () => ({ ok: true })),
  close: vi.fn(async () => {}),
}

vi.mock('@ludd/core', async importOriginal => ({
  ...await importOriginal<typeof import('@ludd/core')>(),
  createControlClient: vi.fn(async () => client),
}))

afterEach(() => vi.clearAllMocks())

describe('abortCommand', () => {
  it('aborts a run and closes the control client', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await expect(abortCommand({ runId: 'run-a', workspace: '/tmp' })).resolves.toBe(0)
    expect(createControlClient).toHaveBeenCalledWith('/tmp/.harness/runs/run-a')
    expect(client.abort).toHaveBeenCalledWith({})
    expect(client.close).toHaveBeenCalledOnce()
    expect(log).toHaveBeenCalledWith('Aborted run run-a')
    log.mockRestore()
  })

  it('forwards a reason and teardown request', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await expect(abortCommand({
      runId: 'run-b',
      workspace: '/tmp',
      reason: 'Stop',
      teardown: true,
    })).resolves.toBe(0)
    expect(client.abort).toHaveBeenCalledWith({ reason: 'Stop', teardown: true })
    log.mockRestore()
  })

  it('defaults the workspace to the current directory', async () => {
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue('/tmp/ludd-default-workspace')
    await abortCommand({ runId: 'run-c' })
    expect(createControlClient).toHaveBeenCalledWith('/tmp/ludd-default-workspace/.harness/runs/run-c')
    cwd.mockRestore()
  })
})
