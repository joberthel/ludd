import type { StepContext } from '@ludd/core'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execGuardrail } from '@ludd/guardrails'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { gitWorktreeEnv } from '../git-worktree-env.js'
import { setupGitRepo } from './helpers.js'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-git-wt-dyn-'))
  setupGitRepo(tmpDir)
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

describe('gitWorktreeEnv ephemeral port allocation (AC 7.5.2)', () => {
  it('allocates valid ephemeral port (> 1024) and injects into worktree exec', async () => {
    const adapter = gitWorktreeEnv({
      id: 'ports-env',
      ephemeralPorts: ['APP_PORT'],
    })

    const env = await adapter.provision({ runId: 'run-port-test', workspaceDir: tmpDir })
    expect(env.ephemeralPorts?.APP_PORT).toBeDefined()
    expect(env.ephemeralPorts?.APP_PORT).toBeGreaterThan(1024)
    expect(env.injectedEnv?.APP_PORT).toBe(String(env.ephemeralPorts?.APP_PORT))

    const res = await env.exec([
      'node',
      '-e',
      'console.log("PORT:" + process.env.APP_PORT)',
    ])
    expect(res.exitCode).toBe(0)
    expect(res.stdout).toContain(`PORT:${env.ephemeralPorts?.APP_PORT}`)

    await env.teardown()
  })
})

describe('gitWorktreeEnv dynamic env resolution (AC 7.5.1)', () => {
  it('resolves dynamic env callback using ctx.runId and injects into steps and execGuardrails', async () => {
    const mockCtx = {
      runId: 'r-dynamic-1',
      workspaceDir: tmpDir,
    } as unknown as StepContext

    const adapter = gitWorktreeEnv({
      id: 'dynamic-env',
      env: ctx => ({
        DB_DATABASE: `test_run_${ctx.runId}`,
      }),
    })

    const env = await adapter.provision({
      runId: 'r-dynamic-1',
      workspaceDir: tmpDir,
      ctx: mockCtx,
    })

    expect(env.injectedEnv?.DB_DATABASE).toBe('test_run_r-dynamic-1')

    const res = await env.exec([
      'node',
      '-e',
      'console.log("DB:" + process.env.DB_DATABASE)',
    ])
    expect(res.exitCode).toBe(0)
    expect(res.stdout).toContain('DB:test_run_r-dynamic-1')

    const guardrail = execGuardrail({
      command: ['node', '-e', 'console.log("GUARD:" + process.env.DB_DATABASE)'],
    })
    const verdict = await guardrail.execute({
      environment: env,
      ctx: mockCtx,
      phase: 'afterStep',
      attempt: 1,
      stepId: 'step-db',
      guardrailIndex: 0,
      mcpServerUrl: 'http://localhost:54321/sse',
      mcpAuthToken: 'token',
      runDir: tmpDir,
    })
    expect(verdict.status).toBe('pass')

    await env.teardown()
  })
})

describe('gitWorktreeEnv dynamic env and ports combination', () => {
  it('combines dynamic env and ephemeral ports', async () => {
    const adapter = gitWorktreeEnv({
      id: 'combo-env',
      env: ctx => ({
        DATABASE_NAME: `db_${ctx.runId}`,
      }),
      ephemeralPorts: ['PORT_WEB'],
    })

    const env = await adapter.provision({
      runId: 'r-combo',
      workspaceDir: tmpDir,
    })

    expect(env.ephemeralPorts?.PORT_WEB).toBeGreaterThan(1024)
    expect(env.injectedEnv?.DATABASE_NAME).toBe('db_r-combo')
    expect(env.injectedEnv?.PORT_WEB).toBe(String(env.ephemeralPorts?.PORT_WEB))

    const res = await env.exec([
      'node',
      '-e',
      'console.log(process.env.DATABASE_NAME + ":" + process.env.PORT_WEB)',
    ])
    expect(res.exitCode).toBe(0)
    expect(res.stdout).toContain(`db_r-combo:${env.ephemeralPorts?.PORT_WEB}`)

    await env.teardown()
  })
})
