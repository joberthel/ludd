import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { gitWorktreeEnv } from '../git-worktree-env.js'
import { setupGitRepo } from './helpers.js'

let tmpDir: string
const originalEnv = { ...process.env }

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-git-wt-iso-'))
  setupGitRepo(tmpDir)
  process.env.SECRET_GITHUB_TOKEN = 'ghp_secret_cred'
  process.env.SSH_AUTH_SOCK = '/tmp/test-ssh.sock'
  process.env.NPM_TOKEN = 'npm_secret_token'
})

afterEach(async () => {
  process.env = { ...originalEnv }
  await rm(tmpDir, { recursive: true, force: true })
})

describe('gitWorktreeEnv default-deny credential isolation', () => {
  it('blocks host secrets and SSH_AUTH_SOCK by default', async () => {
    const adapter = gitWorktreeEnv({ id: 'deny-default' })
    const env = await adapter.provision({ runId: 'r-deny', workspaceDir: tmpDir })

    const res = await env.exec([
      'node',
      '-e',
      'console.log(JSON.stringify({ secret: process.env.SECRET_GITHUB_TOKEN, ssh: process.env.SSH_AUTH_SOCK, npm: process.env.NPM_TOKEN }))',
    ])

    expect(res.exitCode).toBe(0)
    const parsed = JSON.parse(res.stdout)
    expect(parsed.secret).toBeUndefined()
    expect(parsed.ssh).toBeUndefined()
    expect(parsed.npm).toBeUndefined()

    await env.teardown()
  })

  it('passes explicitly whitelisted secret while blocking others', async () => {
    const adapter = gitWorktreeEnv({
      id: 'whitelist-npm',
      whitelistEnv: ['NPM_TOKEN'],
    })
    const env = await adapter.provision({ runId: 'r-white', workspaceDir: tmpDir })

    const res = await env.exec([
      'node',
      '-e',
      'console.log(JSON.stringify({ secret: process.env.SECRET_GITHUB_TOKEN, npm: process.env.NPM_TOKEN }))',
    ])

    expect(res.exitCode).toBe(0)
    const parsed = JSON.parse(res.stdout)
    expect(parsed.secret).toBeUndefined()
    expect(parsed.npm).toBe('npm_secret_token')

    await env.teardown()
  })
})

describe('gitWorktreeEnv static and injected environment', () => {
  it('merges staticEnv and injectedEnv into child process', async () => {
    const adapter = gitWorktreeEnv({
      id: 'static-injected',
      whitelistEnv: ['NPM_TOKEN'],
      env: { STATIC_VAR: 'from-static' },
    })
    const env = await adapter.provision({ runId: 'r-merge', workspaceDir: tmpDir })

    const res = await env.exec(
      [
        'node',
        '-e',
        'console.log(JSON.stringify({ npm: process.env.NPM_TOKEN, staticVal: process.env.STATIC_VAR, inj: process.env.INJ_VAR }))',
      ],
      {
        env: { INJ_VAR: 'from-injected' },
      },
    )

    expect(res.exitCode).toBe(0)
    const parsed = JSON.parse(res.stdout)
    expect(parsed.npm).toBe('npm_secret_token')
    expect(parsed.staticVal).toBe('from-static')
    expect(parsed.inj).toBe('from-injected')

    await env.teardown()
  })
})
