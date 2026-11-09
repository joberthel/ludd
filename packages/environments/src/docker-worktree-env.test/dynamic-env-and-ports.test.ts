import type { StepContext } from '@ludd/core'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { dockerWorktreeEnv } from '../docker-worktree-env.js'
import * as hostEnvModule from '../host-env.js'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-dock-dyn-test-'))
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

function mockContainerSpawn() {
  const execSpy = vi.spyOn(hostEnvModule, 'execHostEnvCommand')
  execSpy.mockResolvedValueOnce({
    exitCode: 0,
    stdout: '',
    stderr: '',
    timedOut: false,
  })
  execSpy.mockResolvedValueOnce({
    exitCode: 0,
    stdout: 'c-test-id\n',
    stderr: '',
    timedOut: false,
  })
  execSpy.mockResolvedValue({
    exitCode: 0,
    stdout: 'ok',
    stderr: '',
    timedOut: false,
  })
  return execSpy
}

describe('dockerWorktreeEnv ephemeral ports', () => {
  it('allocates ephemeral port and passes as -e flag to docker exec', async () => {
    const execSpy = mockContainerSpawn()

    const adapter = dockerWorktreeEnv({
      id: 'dock-ports',
      ephemeralPorts: ['APP_PORT'],
    })

    const env = await adapter.provision({ runId: 'r-dock-ports', workspaceDir: tmpDir })
    expect(env.ephemeralPorts?.APP_PORT).toBeGreaterThan(1024)
    expect(env.injectedEnv?.APP_PORT).toBe(String(env.ephemeralPorts?.APP_PORT))

    await env.exec(['node', 'server.js'])
    const lastCall = execSpy.mock.calls[execSpy.mock.calls.length - 1]
    const args = lastCall[1] as string[]
    expect(args).toContain('-e')
    expect(args).toContain(`APP_PORT=${env.ephemeralPorts?.APP_PORT}`)
  })
})

describe('dockerWorktreeEnv dynamic env', () => {
  it('resolves dynamic env callback and passes to docker exec', async () => {
    const execSpy = mockContainerSpawn()
    const mockCtx = {
      runId: 'r-dock-dyn',
      workspaceDir: tmpDir,
    } as unknown as StepContext

    const adapter = dockerWorktreeEnv({
      id: 'dock-dyn',
      env: ctx => ({
        DB_HOST: `db_${ctx.runId}.internal`,
      }),
    })

    const env = await adapter.provision({
      runId: 'r-dock-dyn',
      workspaceDir: tmpDir,
      ctx: mockCtx,
    })

    expect(env.injectedEnv?.DB_HOST).toBe('db_r-dock-dyn.internal')

    await env.exec(['node', 'app.js'])
    const lastCall = execSpy.mock.calls[execSpy.mock.calls.length - 1]
    const args = lastCall[1] as string[]
    expect(args).toContain('-e')
    expect(args).toContain('DB_HOST=db_r-dock-dyn.internal')
  })

  it('combines dynamic env callback and ephemeral ports into docker exec flags', async () => {
    const execSpy = mockContainerSpawn()

    const adapter = dockerWorktreeEnv({
      id: 'dock-combo',
      env: ctx => ({
        SERVICE_NAME: `svc-${ctx.runId}`,
      }),
      ephemeralPorts: ['METRICS_PORT'],
    })

    const env = await adapter.provision({
      runId: 'r-combo',
      workspaceDir: tmpDir,
    })

    expect(env.ephemeralPorts?.METRICS_PORT).toBeGreaterThan(1024)
    expect(env.injectedEnv?.SERVICE_NAME).toBe('svc-r-combo')
    expect(env.injectedEnv?.METRICS_PORT).toBe(String(env.ephemeralPorts?.METRICS_PORT))

    await env.exec(['node', 'main.js'])
    const lastCall = execSpy.mock.calls[execSpy.mock.calls.length - 1]
    const args = lastCall[1] as string[]
    expect(args).toContain(`SERVICE_NAME=svc-r-combo`)
    expect(args).toContain(`METRICS_PORT=${env.ephemeralPorts?.METRICS_PORT}`)
  })
})
