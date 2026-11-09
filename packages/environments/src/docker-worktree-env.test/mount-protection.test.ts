import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { ForbiddenMountPathError } from '@ludd/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { dockerWorktreeEnv } from '../docker-worktree-env.js'
import * as hostEnvModule from '../host-env.js'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-dock-mount-test-'))
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

function mockSpawnSuccess(execSpy: ReturnType<typeof vi.spyOn>, containerId = 'cid-test'): void {
  execSpy.mockResolvedValueOnce({
    exitCode: 0,
    stdout: '',
    stderr: '',
    timedOut: false,
  })
  execSpy.mockResolvedValueOnce({
    exitCode: 0,
    stdout: `${containerId}\n`,
    stderr: '',
    timedOut: false,
  })
}

describe('dockerWorktreeEnv forbidden mounts (ADR-0009)', () => {
  it('throws ForbiddenMountPathError when customMounts contains a path inside .harness/runs', async () => {
    const runsPath = path.join(tmpDir, '.harness', 'runs', 'run-1')
    const adapter = dockerWorktreeEnv({
      id: 'dock-runs-forbidden',
      customMounts: [
        {
          hostPath: runsPath,
          containerPath: '/harness-runs',
        },
      ],
    })

    await expect(adapter.provision({ runId: 'run-1', workspaceDir: tmpDir })).rejects.toThrow(
      ForbiddenMountPathError,
    )
  })

  it('throws ForbiddenMountPathError when mounts contains a path inside .git/hooks', async () => {
    const adapter = dockerWorktreeEnv({
      id: 'dock-hooks-forbidden',
      mounts: [
        {
          hostPath: '.git/hooks',
          containerPath: '/hooks',
        },
      ],
    })

    await expect(adapter.provision({ runId: 'run-2', workspaceDir: tmpDir })).rejects.toThrow(
      ForbiddenMountPathError,
    )
  })
})

describe('dockerWorktreeEnv custom mounts configuration (ADR-0009)', () => {
  it('passes custom mounts to docker run when valid', async () => {
    const execSpy = vi.spyOn(hostEnvModule, 'execHostEnvCommand')
    mockSpawnSuccess(execSpy, 'cid-custom')

    const validCustomDir = path.join(tmpDir, 'shared-cache')
    const adapter = dockerWorktreeEnv({
      id: 'dock-custom-mounts',
      customMounts: [
        {
          hostPath: validCustomDir,
          containerPath: '/cache',
          readonly: true,
        },
      ],
    })

    await adapter.provision({ runId: 'run-custom', workspaceDir: tmpDir })

    const dockerRunCall = execSpy.mock.calls.find(call => Array.isArray(call[1]) && call[1][0] === 'docker' && call[1][1] === 'run')
    expect(dockerRunCall).toBeDefined()
    const args = dockerRunCall?.[1] as string[]
    expect(args).toContain('-v')
    expect(args).toContain(`${validCustomDir}:/cache:ro`)
  })
})

describe('dockerWorktreeEnv dangerMode root privileges (ADR-0009)', () => {
  it('exposes supportsDangerMode: true on adapter and provisioned environment', async () => {
    const execSpy = vi.spyOn(hostEnvModule, 'execHostEnvCommand')
    mockSpawnSuccess(execSpy, 'cid-123')

    const adapter = dockerWorktreeEnv({ id: 'dock-danger-flag' })
    expect(adapter.supportsDangerMode).toBe(true)

    const env = await adapter.provision({ runId: 'run-danger-flag', workspaceDir: tmpDir })
    expect(env.supportsDangerMode).toBe(true)
  })

  it('adds -u 0:0 to docker exec args when dangerMode: true, and omits it otherwise', async () => {
    const execSpy = vi.spyOn(hostEnvModule, 'execHostEnvCommand')
    mockSpawnSuccess(execSpy, 'cid-exec-danger')
    execSpy.mockResolvedValue({
      exitCode: 0,
      stdout: 'root\n',
      stderr: '',
      timedOut: false,
    })

    const adapter = dockerWorktreeEnv({ id: 'dock-exec-danger' })
    const env = await adapter.provision({ runId: 'run-exec-danger', workspaceDir: tmpDir })

    await env.exec(['whoami'], { dangerMode: true })
    const lastCallWithDanger = execSpy.mock.calls[execSpy.mock.calls.length - 1]
    const argsWithDanger = lastCallWithDanger[1] as string[]
    const uIndex = argsWithDanger.indexOf('-u')
    expect(uIndex).toBeGreaterThan(-1)
    expect(argsWithDanger[uIndex + 1]).toBe('0:0')

    await env.exec(['whoami'])
    const lastCallSafe = execSpy.mock.calls[execSpy.mock.calls.length - 1]
    const argsSafe = lastCallSafe[1] as string[]
    expect(argsSafe).not.toContain('-u')
  })
})
