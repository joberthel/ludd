import type { StepContext } from '../../types/context.js'
import fs from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as envExec from '../environment-exec.js'
import {
  createGitWorktreeEnvironmentFromDescriptor,
  rehydrateEnvironmentsAndCheckHealth,
} from '../environment-manager.js'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-rehydrate-wt-test-'))
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

describe('createGitWorktreeEnvironmentFromDescriptor properties and exec', () => {
  it('constructs git-worktree provisioned environment with branchName', async () => {
    const wtDir = path.join(tmpDir, 'wt')
    fs.mkdirSync(wtDir)

    const env = createGitWorktreeEnvironmentFromDescriptor({
      id: 'wt-1',
      type: 'git-worktree',
      workingDir: wtDir,
      branchName: 'feature/branch',
    })

    expect(env.__kind).toBe('environment')
    expect(env.id).toBe('wt-1')
    expect(env.type).toBe('git-worktree')
    expect(env.branchName).toBe('feature/branch')
    expect(env.workingDir).toBe(wtDir)
  })

  it('exec runs command using execHostCommand with options and signal', async () => {
    const wtDir = path.join(tmpDir, 'wt')
    fs.mkdirSync(wtDir)

    const execSpy = vi.spyOn(envExec, 'execHostCommand').mockResolvedValue({
      exitCode: 0,
      stdout: 'done\n',
      stderr: '',
      timedOut: false,
    })

    const env = createGitWorktreeEnvironmentFromDescriptor({
      id: 'wt-exec',
      workingDir: wtDir,
    })

    const res = await env.exec(['git', 'status'])
    expect(res.stdout).toBe('done\n')
    expect(execSpy).toHaveBeenCalledWith(wtDir, ['git', 'status'], expect.any(Object))
    execSpy.mockRestore()
  })
})

describe('createGitWorktreeEnvironmentFromDescriptor ping', () => {
  it('ping checks directory existence, runs git rev-parse, and catches errors', async () => {
    const nonExistent = path.join(tmpDir, 'non-existent')
    const envMissing = createGitWorktreeEnvironmentFromDescriptor({
      id: 'wt-missing',
      workingDir: nonExistent,
    })
    expect(await envMissing.ping()).toBe(false)

    const wtDir = path.join(tmpDir, 'wt-ping')
    fs.mkdirSync(wtDir)
    const envExisting = createGitWorktreeEnvironmentFromDescriptor({
      id: 'wt-existing',
      workingDir: wtDir,
    })

    const execSpy = vi.spyOn(envExec, 'execHostCommand')
    execSpy.mockResolvedValueOnce({
      exitCode: 0,
      stdout: 'true\n',
      stderr: '',
      timedOut: false,
    })
    expect(await envExisting.ping()).toBe(true)

    execSpy.mockResolvedValueOnce({
      exitCode: 1,
      stdout: '',
      stderr: 'fatal',
      timedOut: false,
    })
    expect(await envExisting.ping()).toBe(false)

    execSpy.mockRejectedValueOnce(new Error('command failed'))
    expect(await envExisting.ping()).toBe(false)

    execSpy.mockRestore()
  })
})

describe('createGitWorktreeEnvironmentFromDescriptor teardown', () => {
  it('teardown removes worktree and cleans directory even on git command errors', async () => {
    const wtDir = path.join(tmpDir, '.harness', 'worktrees', 'run-1-wt')
    fs.mkdirSync(wtDir, { recursive: true })

    const execSpy = vi.spyOn(envExec, 'execHostCommand')
    execSpy.mockResolvedValueOnce({
      exitCode: 0,
      stdout: '',
      stderr: '',
      timedOut: false,
    })

    const env = createGitWorktreeEnvironmentFromDescriptor(
      { id: 'wt-td', workingDir: wtDir },
      undefined,
      tmpDir,
    )

    await env.teardown()
    expect(execSpy).toHaveBeenCalledWith(tmpDir, [
      'git',
      'worktree',
      'remove',
      '--force',
      wtDir,
    ], expect.any(Object))
    expect(fs.existsSync(wtDir)).toBe(false)

    // Call teardown again when workingDir does not exist
    await env.teardown()

    fs.mkdirSync(wtDir, { recursive: true })
    execSpy.mockRejectedValueOnce(new Error('git remove failed'))
    const fallbackEnv = createGitWorktreeEnvironmentFromDescriptor({ id: 'wt-td-fallback', workingDir: wtDir })
    await fallbackEnv.teardown()
    expect(fs.existsSync(wtDir)).toBe(false)

    execSpy.mockRestore()
  })
})

describe('rehydrateEnvironmentsAndCheckHealth git-worktree descriptor', () => {
  it('rehydrates git-worktree descriptor and pings reachable environment', async () => {
    const wtDir = path.join(tmpDir, 'wt-rehydrated')
    fs.mkdirSync(wtDir)

    const execSpy = vi.spyOn(envExec, 'execHostCommand')
    execSpy.mockResolvedValue({
      exitCode: 0,
      stdout: 'true',
      stderr: '',
      timedOut: false,
    })

    const ctx: StepContext = {
      runId: 'r-1',
      environments: {},
      steps: {},
      step: { id: 's-1', output: null, attempt: 1 },
      matrix: undefined,
      artifacts: {} as any,
    }

    await rehydrateEnvironmentsAndCheckHealth({
      previousEnvironments: {
        'rehydrated-wt': {
          id: 'rehydrated-wt',
          type: 'git-worktree',
          workingDir: wtDir,
          branchName: 'ludd/r-1-wt',
        },
      },
      ctx,
      workspaceDir: tmpDir,
    })

    expect(ctx.environments['rehydrated-wt']).toBeDefined()
    expect(ctx.environments['rehydrated-wt'].type).toBe('git-worktree')

    execSpy.mockRestore()
  })
})
