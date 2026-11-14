import type { StepContext } from '../../types/context.js'
import fs from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as envExec from '../environment-exec.js'
import {
  createDockerWorktreeEnvironmentFromDescriptor,
  rehydrateEnvironmentsAndCheckHealth,
} from '../environment-manager.js'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-rehydrate-dock-test-'))
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

describe('createDockerWorktreeEnvironmentFromDescriptor properties', () => {
  it('constructs docker-worktree provisioned environment with containerId and branchName', async () => {
    const wtDir = path.join(tmpDir, 'wt')
    fs.mkdirSync(wtDir)

    const env = createDockerWorktreeEnvironmentFromDescriptor({
      id: 'dock-1',
      type: 'docker-worktree',
      workingDir: wtDir,
      branchName: 'feature/docker',
      containerId: 'c-101',
    })

    expect(env.__kind).toBe('environment')
    expect(env.id).toBe('dock-1')
    expect(env.type).toBe('docker-worktree')
    expect(env.supportsDangerMode).toBe(true)
    expect(env.branchName).toBe('feature/docker')
    expect(env.containerId).toBe('c-101')
    expect(env.workingDir).toBe(wtDir)
  })
})

describe('createDockerWorktreeEnvironmentFromDescriptor exec with containerId', () => {
  it('exec runs docker exec with containerId for array and string commands', async () => {
    const wtDir = path.join(tmpDir, 'wt')
    fs.mkdirSync(wtDir)

    const execSpy = vi.spyOn(envExec, 'execHostCommand').mockResolvedValue({
      exitCode: 0,
      stdout: 'done\n',
      stderr: '',
      timedOut: false,
    })

    const env = createDockerWorktreeEnvironmentFromDescriptor({
      id: 'dock-exec',
      workingDir: wtDir,
      containerId: 'c-exec',
    })

    const resArr = await env.exec(['ls', '-la'])
    expect(resArr.stdout).toBe('done\n')
    expect(execSpy).toHaveBeenCalledWith(wtDir, [
      'docker',
      'exec',
      'c-exec',
      'ls',
      '-la',
    ], expect.any(Object))

    const resStr = await env.exec('echo hi')
    expect(resStr.stdout).toBe('done\n')
    expect(execSpy).toHaveBeenCalledWith(wtDir, [
      'docker',
      'exec',
      'c-exec',
      'sh',
      '-c',
      'echo hi',
    ], expect.any(Object))

    await env.exec(['id'], { dangerMode: true })
    expect(execSpy).toHaveBeenCalledWith(wtDir, [
      'docker',
      'exec',
      '-u',
      '0:0',
      'c-exec',
      'id',
    ], expect.any(Object))

    execSpy.mockRestore()
  })
})

describe('createDockerWorktreeEnvironmentFromDescriptor exec fallback without containerId', () => {
  it('exec falls back to execHostCommand when containerId is not provided', async () => {
    const wtDir = path.join(tmpDir, 'wt')
    fs.mkdirSync(wtDir)

    const execSpy = vi.spyOn(envExec, 'execHostCommand').mockResolvedValue({
      exitCode: 0,
      stdout: 'host done\n',
      stderr: '',
      timedOut: false,
    })

    const env = createDockerWorktreeEnvironmentFromDescriptor({
      id: 'dock-no-container',
      workingDir: wtDir,
    })

    const res = await env.exec(['node', '-v'])
    expect(res.stdout).toBe('host done\n')
    expect(execSpy).toHaveBeenCalledWith(wtDir, ['node', '-v'], expect.any(Object))

    execSpy.mockRestore()
  })
})

describe('createDockerWorktreeEnvironmentFromDescriptor ping missing checks', () => {
  it('returns false when directory is missing or containerId is absent', async () => {
    const nonExistent = path.join(tmpDir, 'non-existent')
    const envMissing = createDockerWorktreeEnvironmentFromDescriptor({
      id: 'dock-missing',
      workingDir: nonExistent,
      containerId: 'c-miss',
    })
    expect(await envMissing.ping()).toBe(false)

    const wtDir = path.join(tmpDir, 'wt-no-cid')
    fs.mkdirSync(wtDir)
    const envNoCid = createDockerWorktreeEnvironmentFromDescriptor({
      id: 'dock-no-cid',
      workingDir: wtDir,
    })
    expect(await envNoCid.ping()).toBe(false)
  })
})

describe('createDockerWorktreeEnvironmentFromDescriptor ping status', () => {
  it('pings container running status and handles false or failures', async () => {
    const wtDir = path.join(tmpDir, 'wt-dock-ping')
    fs.mkdirSync(wtDir)
    const env = createDockerWorktreeEnvironmentFromDescriptor({
      id: 'dock-ping',
      workingDir: wtDir,
      containerId: 'c-ping',
    })

    const execSpy = vi.spyOn(envExec, 'execHostCommand')
    execSpy.mockResolvedValueOnce({
      exitCode: 0,
      stdout: 'true\n',
      stderr: '',
      timedOut: false,
    })
    expect(await env.ping()).toBe(true)

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
      stderr: 'error',
      timedOut: false,
    })
    expect(await env.ping()).toBe(false)

    execSpy.mockRejectedValueOnce(new Error('docker daemon stopped'))
    expect(await env.ping()).toBe(false)

    execSpy.mockRestore()
  })
})

describe('rehydrateEnvironmentsAndCheckHealth docker-worktree descriptor', () => {
  it('rehydrates docker-worktree descriptor and pings running container', async () => {
    const wtDir = path.join(tmpDir, 'wt-dock-rehydrated')
    fs.mkdirSync(wtDir)

    const execSpy = vi.spyOn(envExec, 'execHostCommand')
    execSpy.mockResolvedValue({
      exitCode: 0,
      stdout: 'true',
      stderr: '',
      timedOut: false,
    })

    const ctx: StepContext = {
      runId: 'r-dock',
      environments: {},
      steps: {},
      step: { id: 's-1', output: null, attempt: 1 },
      matrix: undefined,
      artifacts: {} as any,
    }

    await rehydrateEnvironmentsAndCheckHealth({
      previousEnvironments: {
        'dock-env': {
          id: 'dock-env',
          type: 'docker-worktree',
          workingDir: wtDir,
          containerId: 'c-rehydrated',
        },
      },
      ctx,
      workspaceDir: tmpDir,
    })

    expect(ctx.environments['dock-env']).toBeDefined()
    expect(ctx.environments['dock-env'].type).toBe('docker-worktree')

    execSpy.mockRestore()
  })

  it('translates MCP_SERVER_URL to host.docker.internal and sanitizes host exec options', async () => {
    const wtDir = path.join(tmpDir, 'wt-dock-exec-sanitize')
    fs.mkdirSync(wtDir)

    const execSpy = vi.spyOn(envExec, 'execHostCommand')
    execSpy.mockResolvedValue({
      exitCode: 0,
      stdout: 'ok',
      stderr: '',
      timedOut: false,
    })

    const env = createDockerWorktreeEnvironmentFromDescriptor({
      id: 'dock-env',
      workingDir: wtDir,
      containerId: 'c-123',
      injectedEnv: {
        MCP_SERVER_URL: 'http://127.0.0.1:54321/sse',
      },
    })

    await env.exec(['node', '-v'], {
      timeoutMs: 5000,
      env: {
        OTHER_VAR: 'value',
      },
      host: true,
    } as any)

    expect(execSpy).toHaveBeenCalledWith(
      wtDir,
      [
        'docker',
        'exec',
        '-e',
        'MCP_SERVER_URL=http://host.docker.internal:54321/sse',
        '-e',
        'OTHER_VAR=value',
        'c-123',
        'node',
        '-v',
      ],
      {
        timeoutMs: 5000,
        signal: undefined,
      },
    )

    execSpy.mockRestore()
  })
})
