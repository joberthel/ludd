import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { dockerWorktreeEnv } from '../docker-worktree-env.js'
import * as hostEnvModule from '../host-env.js'

let tmpDir: string
const originalEnv = { ...process.env }

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-dock-iso-'))
  process.env.SECRET_GITHUB_TOKEN = 'ghp_secret_cred'
  process.env.SSH_AUTH_SOCK = '/tmp/test-ssh.sock'
  process.env.NPM_TOKEN = 'npm_secret_token'
})

afterEach(async () => {
  process.env = { ...originalEnv }
  await rm(tmpDir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

async function setupProvisionedDockerEnv(options?: {
  whitelistEnv?: readonly string[]
  env?: Record<string, string>
}) {
  const execSpy = vi.spyOn(hostEnvModule, 'execHostEnvCommand')
  execSpy.mockResolvedValueOnce({
    exitCode: 0,
    stdout: '',
    stderr: '',
    timedOut: false,
  })
  execSpy.mockResolvedValueOnce({
    exitCode: 0,
    stdout: 'c-iso-id\n',
    stderr: '',
    timedOut: false,
  })

  const adapter = dockerWorktreeEnv({
    id: 'dock-iso',
    whitelistEnv: options?.whitelistEnv,
    env: options?.env,
  })
  const env = await adapter.provision({ runId: 'r-iso', workspaceDir: tmpDir })
  return { env, execSpy }
}

describe('dockerWorktreeEnv default-deny credential isolation', () => {
  it('blocks host secrets and SSH_AUTH_SOCK from docker exec by default', async () => {
    const { env, execSpy } = await setupProvisionedDockerEnv()
    execSpy.mockResolvedValue({
      exitCode: 0,
      stdout: '',
      stderr: '',
      timedOut: false,
    })

    await env.exec(['node', 'script.js'])

    const lastCall = execSpy.mock.calls[execSpy.mock.calls.length - 1]
    const args = lastCall?.[1] as string[]
    expect(args).toBeDefined()

    expect(args.some(arg => arg.includes('SECRET_GITHUB_TOKEN'))).toBe(false)
    expect(args.some(arg => arg.includes('SSH_AUTH_SOCK'))).toBe(false)
    expect(args.some(arg => arg.includes('NPM_TOKEN'))).toBe(false)
  })

  it('passes whitelisted secret to docker exec via -e flag', async () => {
    const { env, execSpy } = await setupProvisionedDockerEnv({
      whitelistEnv: ['NPM_TOKEN'],
    })
    execSpy.mockResolvedValue({
      exitCode: 0,
      stdout: '',
      stderr: '',
      timedOut: false,
    })

    await env.exec(['node', 'script.js'])

    const lastCall = execSpy.mock.calls[execSpy.mock.calls.length - 1]
    const args = lastCall?.[1] as string[]
    expect(args).toBeDefined()

    expect(args).toContain('-e')
    expect(args).toContain('NPM_TOKEN=npm_secret_token')
    expect(args.some(arg => arg.includes('SECRET_GITHUB_TOKEN'))).toBe(false)
    expect(args.some(arg => arg.includes('SSH_AUTH_SOCK'))).toBe(false)
  })
})

describe('dockerWorktreeEnv static and injected environment', () => {
  it('forwards staticEnv and injectedEnv to docker exec flags', async () => {
    const { env, execSpy } = await setupProvisionedDockerEnv({
      whitelistEnv: ['NPM_TOKEN'],
      env: { STATIC_CONF: 'conf-val' },
    })
    execSpy.mockResolvedValue({
      exitCode: 0,
      stdout: '',
      stderr: '',
      timedOut: false,
    })

    await env.exec(['node', 'script.js'], {
      env: { INJECTED_KEY: 'inj-val' },
    })

    const lastCall = execSpy.mock.calls[execSpy.mock.calls.length - 1]
    const args = lastCall?.[1] as string[]
    expect(args).toBeDefined()

    expect(args).toContain('NPM_TOKEN=npm_secret_token')
    expect(args).toContain('STATIC_CONF=conf-val')
    expect(args).toContain('INJECTED_KEY=inj-val')
  })
})
