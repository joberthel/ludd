import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { gitWorktreeEnv } from './git-worktree-env.js'
import * as hostEnvModule from './host-env.js'

describe('gitWorktreeEnv.rehydrate', () => {
  it('rehydrates a git-worktree environment from descriptor and delegates exec/ping/teardown', async () => {
    const execSpy = vi.spyOn(hostEnvModule, 'execHostEnvCommand').mockResolvedValue({
      exitCode: 0,
      stdout: 'ok',
      stderr: '',
      timedOut: false,
    })

    try {
      const adapter = gitWorktreeEnv({
        id: 'wt-1',
        whitelistEnv: ['PATH'],
      })
      expect(adapter.rehydrate).toBeDefined()

      const env = await adapter.rehydrate!(
        {
          id: 'wt-1',
          type: 'git-worktree',
          workingDir: '/tmp/ws/.harness/worktrees/run-1-wt-1',
          branchName: 'ludd/run-1-wt-1',
          ephemeralPorts: { PORT: 5000 },
          injectedEnv: { CUSTOM: 'val' },
          whitelistEnv: ['PATH', 'HOME'],
          tornDown: false,
        },
        {
          runId: 'run-1',
          workspaceDir: '/tmp/ws',
        },
      )

      expect(env.id).toBe('wt-1')
      expect(env.type).toBe('git-worktree')
      expect(env.workingDir).toBe(path.resolve('/tmp/ws/.harness/worktrees/run-1-wt-1'))
      expect(env.branchName).toBe('ludd/run-1-wt-1')
      expect(env.ephemeralPorts).toEqual({ PORT: 5000 })
      expect(env.injectedEnv).toEqual({ CUSTOM: 'val' })
      expect(env.whitelistEnv).toEqual(['PATH', 'HOME'])

      await env.exec('echo hi')
      expect(execSpy).toHaveBeenCalledWith(
        path.resolve('/tmp/ws/.harness/worktrees/run-1-wt-1'),
        'echo hi',
        expect.objectContaining({
          inheritEnv: false,
          env: expect.objectContaining({ CUSTOM: 'val' }),
        }),
      )

      await env.teardown()
      expect(execSpy).toHaveBeenCalledWith(
        path.resolve('/tmp/ws'),
        [
          'git',
          'worktree',
          'remove',
          '--force',
          path.resolve('/tmp/ws/.harness/worktrees/run-1-wt-1'),
        ],
        expect.any(Object),
      )
    }
    finally {
      execSpy.mockRestore()
    }
  })

  it('rehydrates without optional branchName or whitelistEnv', async () => {
    const adapter = gitWorktreeEnv({ id: 'wt-min' })
    const env = await adapter.rehydrate!(
      {
        id: 'wt-min',
        type: 'git-worktree',
        workingDir: '/tmp/ws/.harness/worktrees/run-1-wt-min',
        tornDown: false,
      },
      {
        runId: 'run-1',
        workspaceDir: '/tmp/ws',
      },
    )
    expect(env.branchName).toBeUndefined()
    expect(env.whitelistEnv).toBeUndefined()
  })
})
