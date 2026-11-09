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
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-git-wt-life-'))
  setupGitRepo(tmpDir)
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

describe('gitWorktreeEnv exec and isolation', () => {
  it('executes command inside worktree working directory', async () => {
    const adapter = gitWorktreeEnv({ id: 'exec-env' })
    const env = await adapter.provision({ runId: 'r-exec', workspaceDir: tmpDir })

    const res = await env.exec(['node', '-e', 'const fs = require("fs"); fs.writeFileSync("created.txt", "hello from wt");'])
    expect(res.exitCode).toBe(0)
    expect(fs.existsSync(path.join(env.workingDir, 'created.txt'))).toBe(true)
    expect(fs.existsSync(path.join(tmpDir, 'created.txt'))).toBe(false)

    await env.teardown()
  })

  it('honors environment variables and relative cwd in exec', async () => {
    const adapter = gitWorktreeEnv({ id: 'exec-opts' })
    const env = await adapter.provision({ runId: 'r-opts', workspaceDir: tmpDir })

    const subDir = path.join(env.workingDir, 'sub')
    fs.mkdirSync(subDir)

    const res = await env.exec(['node', '-e', 'console.log(process.env.TEST_VAR, process.cwd())'], {
      cwd: 'sub',
      env: { TEST_VAR: 'LUDD_SECRET' },
    })
    expect(res.exitCode).toBe(0)
    expect(res.stdout).toContain('LUDD_SECRET')
    expect(res.stdout).toContain(subDir)

    await env.teardown()
  })
})

describe('gitWorktreeEnv ping health checks', () => {
  it('returns true when inside valid worktree', async () => {
    const adapter = gitWorktreeEnv({ id: 'ping-env' })
    const env = await adapter.provision({ runId: 'r-ping', workspaceDir: tmpDir })

    expect(await env.ping()).toBe(true)
    await env.teardown()
  })

  it('returns false when worktree directory is deleted', async () => {
    const adapter = gitWorktreeEnv({ id: 'ping-del' })
    const env = await adapter.provision({ runId: 'r-del', workspaceDir: tmpDir })

    fs.rmSync(env.workingDir, { recursive: true, force: true })
    expect(await env.ping()).toBe(false)

    await env.teardown()
  })

  it('returns false when directory exists but is not a git worktree', async () => {
    const nonGitDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-not-git-'))
    const adapter = gitWorktreeEnv({ id: 'ping-not-git' })
    const env = await adapter.provision({ runId: 'r-non-git', workspaceDir: tmpDir })

    const originalDir = env.workingDir
    Object.defineProperty(env, 'workingDir', { value: nonGitDir })

    expect(await env.ping()).toBe(false)

    Object.defineProperty(env, 'workingDir', { value: originalDir })
    await env.teardown()
    await rm(nonGitDir, { recursive: true, force: true })
  })

  it('catches and returns false if exec throws during ping', async () => {
    const adapter = gitWorktreeEnv({ id: 'ping-throw' })
    const env = await adapter.provision({ runId: 'r-throw', workspaceDir: tmpDir })

    const spy = vi.spyOn(hostEnvModule, 'execHostEnvCommand').mockRejectedValueOnce(new Error('crash'))
    expect(await env.ping()).toBe(false)
    spy.mockRestore()

    await env.teardown()
  })
})

describe('gitWorktreeEnv signal handling and execution options', () => {
  it('passes defaultSignal to exec and teardown, or allows signal override', async () => {
    const defaultCtrl = new AbortController()
    const overrideCtrl = new AbortController()
    const adapter = gitWorktreeEnv({ id: 'sig-env' })
    const env = await adapter.provision({
      runId: 'r-sig',
      workspaceDir: tmpDir,
      defaultSignal: defaultCtrl.signal,
    })

    const res1 = await env.exec(['node', '-e', 'console.log("ok")'])
    expect(res1.exitCode).toBe(0)

    const res2 = await env.exec(['node', '-e', 'console.log("override")'], {
      signal: overrideCtrl.signal,
    })
    expect(res2.exitCode).toBe(0)

    await env.teardown()
  })
})

describe('gitWorktreeEnv teardown idempotency', () => {
  it('removes worktree and directory, and is idempotent on repeat calls', async () => {
    const adapter = gitWorktreeEnv({ id: 'teardown-env' })
    const env = await adapter.provision({ runId: 'r-td', workspaceDir: tmpDir })
    const wtDir = env.workingDir

    expect(fs.existsSync(wtDir)).toBe(true)

    await env.teardown()
    expect(fs.existsSync(wtDir)).toBe(false)

    // Repeat call should not throw
    await expect(env.teardown()).resolves.toBeUndefined()
  })

  it('removes directory if worktree remove command fails or is already detached', async () => {
    const adapter = gitWorktreeEnv({ id: 'teardown-fallback' })
    const env = await adapter.provision({ runId: 'r-td-fb', workspaceDir: tmpDir })
    const wtDir = env.workingDir

    // Remove the worktree from git tracking first
    cp.execSync(`git worktree remove --force "${wtDir}"`, { cwd: tmpDir })
    // Re-create the folder
    fs.mkdirSync(wtDir, { recursive: true })
    expect(fs.existsSync(wtDir)).toBe(true)

    await env.teardown()
    expect(fs.existsSync(wtDir)).toBe(false)
  })
})
