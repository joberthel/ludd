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
    expect(execSpy).toHaveBeenCalledWith(
      wtDir,
      expect.arrayContaining([
        'docker',
        'exec',
        'c-exec',
        'ls',
        '-la',
      ]),
      expect.any(Object),
    )

    const resStr = await env.exec('echo hi')
    expect(resStr.stdout).toBe('done\n')
    expect(execSpy).toHaveBeenCalledWith(
      wtDir,
      expect.arrayContaining([
        'docker',
        'exec',
        'c-exec',
        'sh',
        '-c',
        'echo hi',
      ]),
      expect.any(Object),
    )

    await env.exec(['id'], { dangerMode: true })
    expect(execSpy).toHaveBeenCalledWith(
      wtDir,
      expect.arrayContaining([
        'docker',
        'exec',
        '-u',
        '0:0',
        'c-exec',
        'id',
      ]),
      expect.any(Object),
    )

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
      expect.arrayContaining([
        'docker',
        'exec',
        '-e',
        'MCP_SERVER_URL=http://host.docker.internal:54321/sse',
        '-e',
        'OTHER_VAR=value',
        'c-123',
        'node',
        '-v',
      ]),
      {
        timeoutMs: 5000,
        signal: undefined,
      },
    )

    const envHttps = createDockerWorktreeEnvironmentFromDescriptor({
      id: 'dock-env-https',
      workingDir: wtDir,
      containerId: 'c-123',
      injectedEnv: {
        MCP_SERVER_URL: 'https://localhost:54321/sse',
      },
    })
    await envHttps.exec(['node', '-v'])
    expect(execSpy).toHaveBeenLastCalledWith(
      wtDir,
      expect.arrayContaining([
        'docker',
        'exec',
        '-e',
        'MCP_SERVER_URL=https://host.docker.internal:54321/sse',
        'c-123',
        'node',
        '-v',
      ]),
      expect.any(Object),
    )

    const envNoScheme = createDockerWorktreeEnvironmentFromDescriptor({
      id: 'dock-env-noscheme',
      workingDir: wtDir,
      containerId: 'c-123',
      injectedEnv: {
        MCP_SERVER_URL: '127.0.0.1:54321/sse',
      },
    })
    await envNoScheme.exec(['node', '-v'])
    expect(execSpy).toHaveBeenLastCalledWith(
      wtDir,
      expect.arrayContaining([
        'docker',
        'exec',
        '-e',
        'MCP_SERVER_URL=http://host.docker.internal:54321/sse',
        'c-123',
        'node',
        '-v',
      ]),
      expect.any(Object),
    )

    execSpy.mockRestore()
  })
})

describe('createDockerWorktreeEnvironmentFromDescriptor isolation, cwd, metadata, and signal (#78)', () => {
  it('passes -w cwd, custom bridgeHost, whitelistEnv, containerWorkingDir, and preserves defaultSignal when options.signal is undefined', async () => {
    const wtDir = path.join(os.tmpdir(), 'wt-78')
    const controller = new AbortController()
    const origSecret = process.env.LUDD_SECRET_78
    const origAllowed = process.env.LUDD_ALLOWED_78
    process.env.LUDD_SECRET_78 = 'secret-val'
    process.env.LUDD_ALLOWED_78 = 'allowed-val'
    try {
      const execSpy = vi.spyOn(envExec, 'execHostCommand').mockResolvedValue({
        exitCode: 0,
        stdout: 'ok\n',
        stderr: '',
        timedOut: false,
      })

      const env = createDockerWorktreeEnvironmentFromDescriptor({
        id: 'dock-78',
        workingDir: wtDir,
        containerId: 'c-78',
        containerWorkingDir: '/app',
        bridgeHost: '172.17.0.1',
        whitelistEnv: ['LUDD_ALLOWED_78'],
        injectedEnv: { MCP_SERVER_URL: 'http://127.0.0.1:4000/sse' },
      }, controller.signal)

      expect(env.containerWorkingDir).toBe('/app')
      expect(env.bridgeHost).toBe('172.17.0.1')
      expect(env.whitelistEnv).toEqual(['LUDD_ALLOWED_78'])

      await env.exec(['pwd'], { cwd: '/app/sub', signal: undefined })

      expect(execSpy).toHaveBeenCalledTimes(1)
      const [, args, execOpts] = execSpy.mock.calls[0]
      expect(args).toContain('-w')
      expect(args).toContain('/app/sub')
      expect(args).toContain('LUDD_ALLOWED_78=allowed-val')
      expect(args).toContain('MCP_SERVER_URL=http://172.17.0.1:4000/sse')
      expect((args as readonly string[]).join(' ')).not.toContain('LUDD_SECRET_78')
      expect(execOpts?.signal).toBe(controller.signal)
    }
    finally {
      if (origSecret === undefined) {
        delete process.env.LUDD_SECRET_78
      }
      else {
        process.env.LUDD_SECRET_78 = origSecret
      }
      if (origAllowed === undefined) {
        delete process.env.LUDD_ALLOWED_78
      }
      else {
        process.env.LUDD_ALLOWED_78 = origAllowed
      }
    }
  })

  it('isolates host process.env with inheritEnv: false when containerId is absent', async () => {
    const wtDir = path.join(os.tmpdir(), 'wt-78-fallback')
    const controller = new AbortController()
    const origSecret = process.env.LUDD_SECRET_78_FALLBACK
    process.env.LUDD_SECRET_78_FALLBACK = 'secret-val'
    try {
      const execSpy = vi.spyOn(envExec, 'execHostCommand').mockResolvedValue({
        exitCode: 0,
        stdout: 'ok\n',
        stderr: '',
        timedOut: false,
      })

      const env = createDockerWorktreeEnvironmentFromDescriptor({
        id: 'dock-78-fallback',
        workingDir: wtDir,
      }, controller.signal)

      await env.exec(['echo', 'hi'], { signal: undefined })

      expect(execSpy).toHaveBeenCalledWith(
        wtDir,
        ['echo', 'hi'],
        expect.objectContaining({
          signal: controller.signal,
          inheritEnv: false,
        }),
      )
      const [, , execOpts] = execSpy.mock.calls[0]
      expect(execOpts?.env).not.toHaveProperty('LUDD_SECRET_78_FALLBACK')
    }
    finally {
      if (origSecret === undefined) {
        delete process.env.LUDD_SECRET_78_FALLBACK
      }
      else {
        process.env.LUDD_SECRET_78_FALLBACK = origSecret
      }
    }
  })
})
