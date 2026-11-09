import fs from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { dockerWorktreeEnv } from '../docker-worktree-env.js'
import * as hostEnvModule from '../host-env.js'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-dock-prov-err-'))
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

describe('dockerWorktreeEnv git worktree creation errors', () => {
  it('throws error when git worktree creation fails with stderr, stdout, or code', async () => {
    const execSpy = vi.spyOn(hostEnvModule, 'execHostEnvCommand')
    execSpy.mockResolvedValueOnce({
      exitCode: 1,
      stdout: '',
      stderr: 'fatal: invalid reference: develop',
      timedOut: false,
    })

    const adapter = dockerWorktreeEnv({ id: 'bad-wt' })
    await expect(adapter.provision({ runId: 'r-fail', workspaceDir: tmpDir })).rejects.toThrow(
      'Failed to create git worktree: fatal: invalid reference: develop',
    )

    execSpy.mockResolvedValueOnce({
      exitCode: 2,
      stdout: 'git stdout error',
      stderr: '',
      timedOut: false,
    })
    await expect(adapter.provision({ runId: 'r-fail2', workspaceDir: tmpDir })).rejects.toThrow(
      'Failed to create git worktree: git stdout error',
    )

    execSpy.mockResolvedValueOnce({
      exitCode: 3,
      stdout: '',
      stderr: '',
      timedOut: false,
    })
    await expect(adapter.provision({ runId: 'r-fail3', workspaceDir: tmpDir })).rejects.toThrow(
      'Failed to create git worktree: exit code 3',
    )
  })
})

describe('dockerWorktreeEnv docker run failure cleanup', () => {
  it('cleans up worktree and throws error when docker run fails', async () => {
    const execSpy = vi.spyOn(hostEnvModule, 'execHostEnvCommand')
    execSpy.mockResolvedValueOnce({
      exitCode: 0,
      stdout: '',
      stderr: '',
      timedOut: false,
    })
    execSpy.mockResolvedValueOnce({
      exitCode: 125,
      stdout: '',
      stderr: 'docker: Error response from daemon: Conflict.',
      timedOut: false,
    })
    execSpy.mockResolvedValueOnce({
      exitCode: 0,
      stdout: '',
      stderr: '',
      timedOut: false,
    })

    const adapter = dockerWorktreeEnv({ id: 'docker-fail' })
    const worktreePath = path.resolve(tmpDir, '.harness', 'worktrees', 'r-dock-fail-docker-fail')
    fs.mkdirSync(worktreePath, { recursive: true })

    await expect(adapter.provision({ runId: 'r-dock-fail', workspaceDir: tmpDir })).rejects.toThrow(
      'Failed to create docker container: docker: Error response from daemon: Conflict.',
    )

    expect(fs.existsSync(worktreePath)).toBe(false)
  })
})

describe('dockerWorktreeEnv docker run error formatting', () => {
  it('formats docker run error with stdout or exitCode fallback', async () => {
    const execSpy = vi.spyOn(hostEnvModule, 'execHostEnvCommand')
    execSpy.mockResolvedValueOnce({
      exitCode: 0,
      stdout: '',
      stderr: '',
      timedOut: false,
    })
    execSpy.mockResolvedValueOnce({
      exitCode: 1,
      stdout: 'stdout error',
      stderr: '',
      timedOut: false,
    })
    execSpy.mockResolvedValueOnce({
      exitCode: 0,
      stdout: '',
      stderr: '',
      timedOut: false,
    })

    const adapter = dockerWorktreeEnv({ id: 'dock-stdout-err' })
    await expect(adapter.provision({ runId: 'r-out-err', workspaceDir: tmpDir })).rejects.toThrow(
      'Failed to create docker container: stdout error',
    )

    execSpy.mockResolvedValueOnce({
      exitCode: 0,
      stdout: '',
      stderr: '',
      timedOut: false,
    })
    execSpy.mockResolvedValueOnce({
      exitCode: 9,
      stdout: '',
      stderr: '',
      timedOut: false,
    })
    execSpy.mockResolvedValueOnce({
      exitCode: 0,
      stdout: '',
      stderr: '',
      timedOut: false,
    })
    await expect(adapter.provision({ runId: 'r-code-err', workspaceDir: tmpDir })).rejects.toThrow(
      'Failed to create docker container: exit code 9',
    )
  })
})

describe('dockerWorktreeEnv signal passing during provision', () => {
  it('passes defaultSignal to git and docker commands during provision', async () => {
    const execSpy = vi.spyOn(hostEnvModule, 'execHostEnvCommand')
    execSpy.mockResolvedValueOnce({
      exitCode: 0,
      stdout: '',
      stderr: '',
      timedOut: false,
    })
    execSpy.mockResolvedValueOnce({
      exitCode: 0,
      stdout: 'c-sig',
      stderr: '',
      timedOut: false,
    })

    const controller = new AbortController()
    const adapter = dockerWorktreeEnv({ id: 'sig-test' })
    const env = await adapter.provision({
      runId: 'r-sig',
      workspaceDir: tmpDir,
      defaultSignal: controller.signal,
    })

    expect(execSpy).toHaveBeenNthCalledWith(1, expect.any(String), expect.any(Array), { signal: controller.signal })
    expect(execSpy).toHaveBeenNthCalledWith(2, expect.any(String), expect.any(Array), { signal: controller.signal })
    expect(env.id).toBe('sig-test')
  })
})
