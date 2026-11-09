import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { dockerWorktreeEnv } from '../docker-worktree-env.js'
import * as hostEnvModule from '../host-env.js'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-dock-prov-test-'))
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

function mockExecSuccess(execSpy: any, stdout = ''): void {
  execSpy.mockResolvedValueOnce({
    exitCode: 0,
    stdout,
    stderr: '',
    timedOut: false,
  })
}

describe('dockerWorktreeEnv options validation & adapter contract', () => {
  it('throws when id is empty, whitespace, or invalid type', () => {
    expect(() => dockerWorktreeEnv({ id: '' })).toThrow('dockerWorktreeEnv requires a valid non-empty id.')
    expect(() => dockerWorktreeEnv({ id: '   ' })).toThrow('dockerWorktreeEnv requires a valid non-empty id.')
    expect(() => dockerWorktreeEnv({ id: 123 as any })).toThrow('dockerWorktreeEnv requires a valid non-empty id.')
  })

  it('returns valid EnvironmentAdapter contract structure', () => {
    const adapter = dockerWorktreeEnv({ id: 'dock-adapter' })
    expect(adapter.__kind).toBe('environment-adapter')
    expect(adapter.id).toBe('dock-adapter')
    expect(adapter.type).toBe('docker-worktree')
    expect(typeof adapter.provision).toBe('function')
  })
})

describe('dockerWorktreeEnv provisioning with defaults', () => {
  it('provisions git worktree and background docker container with defaults', async () => {
    const execSpy = vi.spyOn(hostEnvModule, 'execHostEnvCommand')
    mockExecSuccess(execSpy)
    mockExecSuccess(execSpy, 'container-id-12345\n')

    const adapter = dockerWorktreeEnv({ id: 'dock-feat' })
    const runId = 'run-101'
    const env = await adapter.provision({ runId, workspaceDir: tmpDir })

    const expectedWorktree = path.resolve(tmpDir, '.harness', 'worktrees', `${runId}-dock-feat`)
    expect(env.__kind).toBe('environment')
    expect(env.id).toBe('dock-feat')
    expect(env.type).toBe('docker-worktree')
    expect(env.workingDir).toBe(expectedWorktree)
    expect(env.containerId).toBe('container-id-12345')
    expect(env.branchName).toBe(`ludd/${runId}-dock-feat`)

    expect(execSpy).toHaveBeenNthCalledWith(1, path.resolve(tmpDir), [
      'git',
      'worktree',
      'add',
      '-b',
      `ludd/${runId}-dock-feat`,
      expectedWorktree,
      'HEAD',
    ], { signal: undefined })

    expect(execSpy).toHaveBeenNthCalledWith(2, path.resolve(tmpDir), [
      'docker',
      'run',
      '-d',
      '--name',
      `ludd-${runId}-dock-feat`,
      '--add-host',
      'host.docker.internal:host-gateway',
      '-v',
      `${expectedWorktree}:/workspace`,
      '-w',
      '/workspace',
      'node:22-alpine',
      'sleep',
      'infinity',
    ], { signal: undefined })
  })
})

describe('dockerWorktreeEnv provisioning with custom options', () => {
  it('supports custom image, containerWorkdir, bridgeHost, baseBranch, and branchPrefix', async () => {
    const execSpy = vi.spyOn(hostEnvModule, 'execHostEnvCommand')
    mockExecSuccess(execSpy)
    mockExecSuccess(execSpy, 'c-custom-888')

    const adapter = dockerWorktreeEnv({
      id: 'custom-env',
      image: 'python:3.12-slim',
      containerWorkdir: '/app',
      bridgeHost: '172.17.0.1',
      baseBranch: 'develop',
      branchPrefix: 'task',
    })
    const runId = 'run-202'
    const env = await adapter.provision({ runId, workspaceDir: tmpDir })

    const expectedWorktree = path.resolve(tmpDir, '.harness', 'worktrees', `${runId}-custom-env`)
    expect(env.branchName).toBe(`task/${runId}-custom-env`)
    expect(env.containerId).toBe('c-custom-888')

    expect(execSpy).toHaveBeenNthCalledWith(1, path.resolve(tmpDir), [
      'git',
      'worktree',
      'add',
      '-b',
      `task/${runId}-custom-env`,
      expectedWorktree,
      'develop',
    ], { signal: undefined })

    expect(execSpy).toHaveBeenNthCalledWith(2, path.resolve(tmpDir), [
      'docker',
      'run',
      '-d',
      '--name',
      `ludd-${runId}-custom-env`,
      '--add-host',
      'host.docker.internal:host-gateway',
      '-v',
      `${expectedWorktree}:/app`,
      '-w',
      '/app',
      'python:3.12-slim',
      'sleep',
      'infinity',
    ], { signal: undefined })
  })
})
