import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { execGuardrail } from '@ludd/guardrails'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { dockerWorktreeEnv } from '../docker-worktree-env.js'
import { gitWorktreeEnv } from '../git-worktree-env.js'
import { setupGitRepo } from '../git-worktree-env.test/helpers.js'
import * as hostEnvModule from '../host-env.js'
import { hostEnv } from '../host-env.js'

let tmpDir: string
const originalEnv = { ...process.env }

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-priv-sep-'))
  setupGitRepo(tmpDir)
  process.env.GITHUB_TOKEN = 'ghp_prod_privilege_token'
  process.env.SSH_AUTH_SOCK = '/run/user/1000/ssh.sock'
  process.env.NPM_TOKEN = 'npm_public_token'
})

afterEach(async () => {
  process.env = { ...originalEnv }
  await rm(tmpDir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

function mockExecSuccess(stdout = '') {
  return {
    exitCode: 0,
    stdout,
    stderr: '',
    timedOut: false,
  }
}

describe('privilege separation: hostEnv vs isolated environments (ADR-0007)', () => {
  it('retains host secrets in hostEnv while gitWorktreeEnv blocks them', async () => {
    const host = hostEnv({ cwd: tmpDir })
    const nodePath = process.execPath

    const hostRes = await host.exec([
      nodePath,
      '-e',
      'console.log(process.env.GITHUB_TOKEN, process.env.SSH_AUTH_SOCK)',
    ])
    expect(hostRes.exitCode).toBe(0)
    expect(hostRes.stdout).toContain('ghp_prod_privilege_token')
    expect(hostRes.stdout).toContain('/run/user/1000/ssh.sock')

    const wtAdapter = gitWorktreeEnv({
      id: 'priv-sep-wt',
      whitelistEnv: ['NPM_TOKEN'],
    })
    const wtEnv = await wtAdapter.provision({ runId: 'r-priv-wt', workspaceDir: tmpDir })
    const wtRes = await wtEnv.exec([
      nodePath,
      '-e',
      'console.log(JSON.stringify({ gh: process.env.GITHUB_TOKEN, ssh: process.env.SSH_AUTH_SOCK, npm: process.env.NPM_TOKEN }))',
    ])
    expect(wtRes.exitCode).toBe(0)
    const wtParsed = JSON.parse(wtRes.stdout.trim())
    expect(wtParsed.gh).toBeUndefined()
    expect(wtParsed.ssh).toBeUndefined()
    expect(wtParsed.npm).toBe('npm_public_token')
    await wtEnv.teardown()
  })

  it('blocks host secrets from dockerWorktreeEnv unless whitelisted', async () => {
    const execSpy = vi.spyOn(hostEnvModule, 'execHostEnvCommand')
    execSpy.mockResolvedValueOnce(mockExecSuccess())
    execSpy.mockResolvedValueOnce(mockExecSuccess('c-dock\n'))
    execSpy.mockResolvedValue(mockExecSuccess())

    const dockAdapter = dockerWorktreeEnv({
      id: 'priv-sep-dock',
      whitelistEnv: ['NPM_TOKEN'],
    })
    const dockEnv = await dockAdapter.provision({ runId: 'r-priv-dock', workspaceDir: tmpDir })
    await dockEnv.exec(['git', 'status'])

    const lastCall = execSpy.mock.calls[execSpy.mock.calls.length - 1]
    const args = lastCall?.[1] as string[]
    expect(args).toBeDefined()
    expect(args.some(a => a.includes('GITHUB_TOKEN'))).toBe(false)
    expect(args.some(a => a.includes('SSH_AUTH_SOCK'))).toBe(false)
    expect(args).toContain('NPM_TOKEN=npm_public_token')
  })
})

describe('privilege separation: execGuardrail on hostEnv', () => {
  it('executes privileged operations with hostEnv retaining GITHUB_TOKEN', async () => {
    const host = hostEnv({ cwd: tmpDir })
    const nodePath = process.execPath

    const guardrail = execGuardrail({
      environment: host,
      command: [
        nodePath,
        '-e',
        'if (!process.env.GITHUB_TOKEN) { process.exit(1); } console.log("push success with " + process.env.GITHUB_TOKEN);',
      ],
    })

    const verdict = await guardrail.execute({
      ctx: {} as any,
      stepId: 'push-step',
      phase: 'afterStep',
      guardrailIndex: 0,
      attempt: 1,
      runDir: tmpDir,
      environment: host,
      mcpServerUrl: 'http://127.0.0.1:4000',
      mcpAuthToken: 'token',
    })

    expect(verdict.status).toBe('pass')
  })
})
