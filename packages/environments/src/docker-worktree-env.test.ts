import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { dockerWorktreeEnv } from './docker-worktree-env.js'
import * as hostEnvModule from './host-env.js'

describe('dockerWorktreeEnv.rehydrate', () => {
  it('rehydrates a docker-worktree environment from descriptor and delegates exec/ping/teardown', async () => {
    const execSpy = vi.spyOn(hostEnvModule, 'execHostEnvCommand').mockResolvedValue({
      exitCode: 0,
      stdout: 'true\n',
      stderr: '',
      timedOut: false,
    })

    try {
      const adapter = dockerWorktreeEnv({ id: 'dk-1' })
      expect(adapter.rehydrate).toBeDefined()

      const env = await adapter.rehydrate!(
        {
          id: 'dk-1',
          type: 'docker-worktree',
          workingDir: '/tmp/ws/.harness/worktrees/run-1-dk-1',
          containerId: 'cid-123',
          branchName: 'ludd/run-1-dk-1',
          containerWorkingDir: '/app',
          bridgeHost: 'host.docker.internal',
          whitelistEnv: ['PATH'],
          ephemeralPorts: { PORT: 6000 },
          injectedEnv: { MCP_SERVER_URL: 'http://127.0.0.1:6000' },
          tornDown: false,
        },
        {
          runId: 'run-1',
          workspaceDir: '/tmp/ws',
        },
      )

      expect(env.id).toBe('dk-1')
      expect(env.type).toBe('docker-worktree')
      expect(env.containerId).toBe('cid-123')
      expect(env.containerWorkingDir).toBe('/app')
      expect(env.bridgeHost).toBe('host.docker.internal')

      await env.exec(['echo', 'hello'])
      expect(execSpy).toHaveBeenCalledWith(
        path.resolve('/tmp/ws/.harness/worktrees/run-1-dk-1'),
        expect.arrayContaining([
          'docker',
          'exec',
          '-e',
          'MCP_SERVER_URL=http://host.docker.internal:6000',
          'cid-123',
          'echo',
          'hello',
        ]),
        expect.any(Object),
      )

      await env.teardown()
      expect(execSpy).toHaveBeenCalledWith(
        path.resolve('/tmp/ws'),
        ['docker', 'rm', '-f', 'cid-123'],
        expect.any(Object),
      )
      expect(execSpy).toHaveBeenCalledWith(
        path.resolve('/tmp/ws'),
        [
          'git',
          'worktree',
          'remove',
          '--force',
          path.resolve('/tmp/ws/.harness/worktrees/run-1-dk-1'),
        ],
        expect.any(Object),
      )
    }
    finally {
      execSpy.mockRestore()
    }
  })

  it('falls back to host exec, returns false on ping, and skips container removal when containerId is missing', async () => {
    const execSpy = vi.spyOn(hostEnvModule, 'execHostEnvCommand').mockResolvedValue({
      exitCode: 0,
      stdout: 'host-ok',
      stderr: '',
      timedOut: false,
    })

    try {
      const adapter = dockerWorktreeEnv({ id: 'dk-no-cid' })
      const env = await adapter.rehydrate!(
        {
          id: 'dk-no-cid',
          type: 'docker-worktree',
          workingDir: '/tmp/ws/.harness/worktrees/run-1-dk-no-cid',
          tornDown: false,
        },
        {
          runId: 'run-1',
          workspaceDir: '/tmp/ws',
        },
      )

      expect(await env.ping()).toBe(false)

      const res = await env.exec('echo fallback')
      expect(res.stdout).toBe('host-ok')
      expect(execSpy).toHaveBeenCalledWith(
        path.resolve('/tmp/ws/.harness/worktrees/run-1-dk-no-cid'),
        'echo fallback',
        expect.objectContaining({ inheritEnv: false }),
      )

      await env.teardown()
      expect(execSpy).not.toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining(['docker', 'rm']),
        expect.any(Object),
      )
    }
    finally {
      execSpy.mockRestore()
    }
  })
})
