import fs from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { dockerWorktreeEnv } from '../docker-worktree-env.js'
import * as hostEnvModule from '../host-env.js'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-dock-life-test-'))
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

async function createProvisionedEnv() {
  const execSpy = vi.spyOn(hostEnvModule, 'execHostEnvCommand')
  execSpy.mockResolvedValueOnce({
    exitCode: 0,
    stdout: '',
    stderr: '',
    timedOut: false,
  })
  execSpy.mockResolvedValueOnce({
    exitCode: 0,
    stdout: 'c-life-999\n',
    stderr: '',
    timedOut: false,
  })

  const adapter = dockerWorktreeEnv({ id: 'dock-life' })
  const env = await adapter.provision({ runId: 'r-life', workspaceDir: tmpDir })
  // Create worktree folder to simulate active filesystem state
  fs.mkdirSync(env.workingDir, { recursive: true })
  return { env, execSpy }
}

describe('dockerWorktreeEnv ping health checks', () => {
  it('returns true when worktree exists on disk and container inspect reports running', async () => {
    const { env, execSpy } = await createProvisionedEnv()
    execSpy.mockResolvedValueOnce({
      exitCode: 0,
      stdout: 'true\n',
      stderr: '',
      timedOut: false,
    })

    expect(await env.ping()).toBe(true)
    expect(execSpy).toHaveBeenLastCalledWith(
      env.workingDir,
      [
        'docker',
        'inspect',
        '-f',
        '{{.State.Running}}',
        'c-life-999',
      ],
      expect.any(Object),
    )
  })

  it('returns false when worktree directory is removed from disk', async () => {
    const { env } = await createProvisionedEnv()
    fs.rmSync(env.workingDir, { recursive: true, force: true })

    expect(await env.ping()).toBe(false)
  })

  it('returns false when container inspect reports not running or non-zero exit', async () => {
    const { env, execSpy } = await createProvisionedEnv()

    execSpy.mockResolvedValueOnce({
      exitCode: 0,
      stdout: 'false\n',
      stderr: '',
      timedOut: false,
    })
    expect(await env.ping()).toBe(false)

    execSpy.mockResolvedValueOnce({
      exitCode: 1,
      stdout: '',
      stderr: 'Error: No such container: c-life-999',
      timedOut: false,
    })
    expect(await env.ping()).toBe(false)
  })

  it('catches and returns false if docker inspect command throws', async () => {
    const { env, execSpy } = await createProvisionedEnv()
    execSpy.mockRejectedValueOnce(new Error('docker daemon socket disconnected'))

    expect(await env.ping()).toBe(false)
  })
})

describe('dockerWorktreeEnv teardown idempotency and error tolerance', () => {
  it('stops and removes container, removes git worktree, and cleans up directory', async () => {
    const { env, execSpy } = await createProvisionedEnv()
    const wtDir = env.workingDir
    expect(fs.existsSync(wtDir)).toBe(true)

    execSpy.mockResolvedValue({
      exitCode: 0,
      stdout: '',
      stderr: '',
      timedOut: false,
    })

    await env.teardown()

    expect(execSpy).toHaveBeenCalledWith(
      path.resolve(tmpDir),
      ['docker', 'rm', '-f', 'c-life-999'],
      expect.any(Object),
    )
    expect(execSpy).toHaveBeenCalledWith(
      path.resolve(tmpDir),
      [
        'git',
        'worktree',
        'remove',
        '--force',
        wtDir,
      ],
      expect.any(Object),
    )
    expect(fs.existsSync(wtDir)).toBe(false)

    // Repeated call should succeed without throwing
    await expect(env.teardown()).resolves.toBeUndefined()
  })

  it('ignores errors from docker rm and git worktree remove during teardown', async () => {
    const { env, execSpy } = await createProvisionedEnv()
    const wtDir = env.workingDir

    execSpy.mockRejectedValue(new Error('command failure during teardown'))

    await expect(env.teardown()).resolves.toBeUndefined()
    expect(fs.existsSync(wtDir)).toBe(false)
  })
})
