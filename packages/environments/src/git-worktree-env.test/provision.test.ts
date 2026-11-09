import cp from 'node:child_process'
import fs from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { gitWorktreeEnv } from '../git-worktree-env.js'
import * as hostEnvModule from '../host-env.js'
import { setupGitRepo } from './helpers.js'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-git-wt-prov-'))
  setupGitRepo(tmpDir)
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

describe('gitWorktreeEnv options and adapter contract', () => {
  it('throws when id is empty or not a string', () => {
    expect(() => gitWorktreeEnv({ id: '' })).toThrow('gitWorktreeEnv requires a valid non-empty id.')
    expect(() => gitWorktreeEnv({ id: '   ' })).toThrow('gitWorktreeEnv requires a valid non-empty id.')
    expect(() => gitWorktreeEnv({ id: 123 as any })).toThrow('gitWorktreeEnv requires a valid non-empty id.')
  })

  it('returns valid EnvironmentAdapter structure', () => {
    const adapter = gitWorktreeEnv({ id: 'feature-env' })
    expect(adapter.__kind).toBe('environment-adapter')
    expect(adapter.id).toBe('feature-env')
    expect(adapter.type).toBe('git-worktree')
    expect(typeof adapter.provision).toBe('function')
  })
})

describe('gitWorktreeEnv provisioning branches', () => {
  it('creates worktree directory and branch with default prefix', async () => {
    const adapter = gitWorktreeEnv({ id: 'feat' })
    const runId = 'run-101'
    const env = await adapter.provision({ runId, workspaceDir: tmpDir })

    const expectedWorktree = path.join(tmpDir, '.harness', 'worktrees', `${runId}-feat`)
    expect(env.__kind).toBe('environment')
    expect(env.id).toBe('feat')
    expect(env.type).toBe('git-worktree')
    expect(env.workingDir).toBe(expectedWorktree)
    expect(env.branchName).toBe(`ludd/${runId}-feat`)
    expect(fs.existsSync(expectedWorktree)).toBe(true)

    const branchRes = cp.execSync('git branch --show-current', { cwd: expectedWorktree }).toString().trim()
    expect(branchRes).toBe(`ludd/${runId}-feat`)

    await env.teardown()
  })

  it('supports custom branchPrefix', async () => {
    const adapter = gitWorktreeEnv({ id: 'custom-prefix', branchPrefix: 'task' })
    const runId = 'run-202'
    const env = await adapter.provision({ runId, workspaceDir: tmpDir })

    expect(env.branchName).toBe(`task/${runId}-custom-prefix`)
    const branchRes = cp.execSync('git branch --show-current', { cwd: env.workingDir }).toString().trim()
    expect(branchRes).toBe(`task/${runId}-custom-prefix`)

    await env.teardown()
  })

  it('supports custom baseBranch', async () => {
    cp.execSync('git branch develop', { cwd: tmpDir })
    const adapter = gitWorktreeEnv({ id: 'custom-base', baseBranch: 'develop' })
    const runId = 'run-303'
    const env = await adapter.provision({ runId, workspaceDir: tmpDir })

    expect(env.branchName).toBe(`ludd/${runId}-custom-base`)
    expect(fs.existsSync(env.workingDir)).toBe(true)

    await env.teardown()
  })
})

describe('gitWorktreeEnv provisioning errors and signals', () => {
  it('throws error when base branch does not exist', async () => {
    const adapter = gitWorktreeEnv({ id: 'bad-base', baseBranch: 'does-not-exist' })
    await expect(adapter.provision({ runId: 'run-err', workspaceDir: tmpDir })).rejects.toThrow(
      /Failed to create git worktree/,
    )
  })

  it('formats error message when stderr is empty but stdout has text', async () => {
    const spy = vi.spyOn(hostEnvModule, 'execHostEnvCommand').mockResolvedValueOnce({
      exitCode: 1,
      stdout: 'stdout error occurred',
      stderr: '',
      timedOut: false,
    })
    const adapter = gitWorktreeEnv({ id: 'stdout-err' })
    await expect(adapter.provision({ runId: 'run-stdout', workspaceDir: tmpDir })).rejects.toThrow(
      'Failed to create git worktree: stdout error occurred',
    )
    spy.mockRestore()
  })

  it('formats error message when both stderr and stdout are empty', async () => {
    const spy = vi.spyOn(hostEnvModule, 'execHostEnvCommand').mockResolvedValueOnce({
      exitCode: 2,
      stdout: '',
      stderr: '',
      timedOut: false,
    })
    const adapter = gitWorktreeEnv({ id: 'exit-code-err' })
    await expect(adapter.provision({ runId: 'run-code', workspaceDir: tmpDir })).rejects.toThrow(
      'Failed to create git worktree: exit code 2',
    )
    spy.mockRestore()
  })

  it('passes defaultSignal to worktree add command', async () => {
    const controller = new AbortController()
    const adapter = gitWorktreeEnv({ id: 'sig-test' })
    const env = await adapter.provision({
      runId: 'run-sig',
      workspaceDir: tmpDir,
      defaultSignal: controller.signal,
    })
    expect(env.id).toBe('sig-test')
    await env.teardown()
  })
})
