import { gc } from '@ludd/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { gcCommand } from './gc-command.js'

vi.mock('@ludd/core', async importOriginal => ({
  ...await importOriginal<typeof import('@ludd/core')>(),
  gc: vi.fn(async () => ({
    cleanedRunIds: ['a'],
    skippedActiveRunIds: ['b'],
  })),
}))

afterEach(() => vi.restoreAllMocks())

describe('gcCommand', () => {
  it('forwards target filters and duration, then prints summary', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await expect(gcCommand({
      runId: ['a', 'b'],
      olderThan: '2h',
      status: ['passed'],
      dryRun: true,
      workspace: '/tmp',
    })).resolves.toBe(0)
    expect(gc).toHaveBeenCalledWith(expect.objectContaining({
      runId: ['a', 'b'],
      olderThanMs: 7200000,
      status: ['passed'],
      dryRun: true,
    }))
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Would clean'))
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Skipped active'))
  })

  it('uses defaults and reports empty cleanup results', async () => {
    vi.mocked(gc).mockResolvedValueOnce({ cleanedRunIds: [], skippedActiveRunIds: [] })
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await expect(gcCommand({})).resolves.toBe(0)
    expect(gc).toHaveBeenCalledWith({
      workspaceDir: process.cwd(),
    })
    expect(log).toHaveBeenCalledWith('Cleaned 0 run(s): none')
    expect(log).toHaveBeenCalledWith('Skipped active 0 run(s): none')
  })
})
