import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { hostEnv } from '../host-env.js'

let tmpDir: string

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ludd-host-env-dyn-'))
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('hostEnv ephemeral port allocation', () => {
  it('allocates ephemeral port and injects it into execution', async () => {
    const env = await hostEnv({
      cwd: tmpDir,
      ephemeralPorts: ['APP_PORT'],
    }).provision({ runId: 'test-run', workspaceDir: tmpDir })

    const res = await env.exec('echo "PORT:$APP_PORT"')
    expect(res.exitCode).toBe(0)
    expect(env.ephemeralPorts).toBeDefined()
    expect(env.ephemeralPorts?.APP_PORT).toBeGreaterThan(1024)
    expect(env.injectedEnv?.APP_PORT).toBe(String(env.ephemeralPorts?.APP_PORT))
    expect(res.stdout).toContain(`PORT:${env.ephemeralPorts?.APP_PORT}`)
  })
})

describe('hostEnv dynamic env and options', () => {
  it('resolves dynamic env callback and injects resolved variables', async () => {
    const env = await hostEnv(
      {
        cwd: tmpDir,
        env: (ctx: any) => ({
          DATABASE_SCHEMA: `schema_${ctx.runId}`,
        }),
      },
      {
        runId: 'custom-run-123',
        workspaceDir: tmpDir,
      },
    ).provision({ runId: 'custom-run-123', workspaceDir: tmpDir })

    const res = await env.exec('echo "DB:$DATABASE_SCHEMA"')
    expect(res.exitCode).toBe(0)
    expect(env.injectedEnv).toEqual({
      DATABASE_SCHEMA: 'schema_custom-run-123',
    })
    expect(res.stdout).toContain('DB:schema_custom-run-123')
  })

  it('combines static env and ephemeral ports and awaits init in ping', async () => {
    const env = await hostEnv({
      cwd: tmpDir,
      env: { SERVICE_NAME: 'payment-svc' },
      ephemeralPorts: ['SVC_PORT'],
    }).provision({ runId: 'test-run', workspaceDir: tmpDir })

    expect(await env.ping()).toBe(true)
    expect(env.injectedEnv?.SERVICE_NAME).toBe('payment-svc')
    expect(env.injectedEnv?.SVC_PORT).toBe(String(env.ephemeralPorts?.SVC_PORT))

    const res = await env.exec('echo "$SERVICE_NAME on $SVC_PORT"')
    expect(res.exitCode).toBe(0)
    expect(res.stdout).toContain(`payment-svc on ${env.ephemeralPorts?.SVC_PORT}`)
  })

  it('supports multiple exec calls with injected env and override env options', async () => {
    const env = await hostEnv({
      cwd: tmpDir,
      env: { BASE_VAR: 'base' },
      ephemeralPorts: ['RUN_PORT'],
    }).provision({ runId: 'test-run', workspaceDir: tmpDir })

    const res1 = await env.exec('echo "BASE:$BASE_VAR PORT:$RUN_PORT"')
    expect(res1.exitCode).toBe(0)
    expect(res1.stdout).toContain(`BASE:base PORT:${env.ephemeralPorts?.RUN_PORT}`)

    const res2 = await env.exec('echo "EXTRA:$EXTRA_VAR BASE:$BASE_VAR"', {
      env: { EXTRA_VAR: 'extra_value' },
    })
    expect(res2.exitCode).toBe(0)
    expect(res2.stdout).toContain('EXTRA:extra_value BASE:base')
  })

  it('populates ephemeralPorts and injectedEnv immediately after provision() before exec() or ping()', async () => {
    const adapter = hostEnv({
      cwd: tmpDir,
      env: async () => ({ ASYNC_VAR: 'resolved' }),
      ephemeralPorts: ['API_PORT'],
    })

    expect(adapter.__kind).toBe('environment-adapter')
    const env = await adapter.provision({ runId: 'test-run', workspaceDir: tmpDir })

    expect(env.ephemeralPorts?.API_PORT).toBeGreaterThan(1024)
    expect(env.injectedEnv).toEqual({
      ASYNC_VAR: 'resolved',
      API_PORT: String(env.ephemeralPorts?.API_PORT),
    })

    // Spreading env (as resolveStepEnvironment does when wrapping exec) preserves properties
    const wrapped = { ...env, exec: env.exec }
    expect(wrapped.ephemeralPorts).toEqual(env.ephemeralPorts)
    expect(wrapped.injectedEnv).toEqual(env.injectedEnv)
  })
})

describe('hostEnv initialization rejection', () => {
  it('propagates rejection when dynamic env callback fails', async () => {
    const adapter = hostEnv({
      cwd: tmpDir,
      env: () => {
        throw new Error('Dynamic env calculation failed')
      },
    })

    await expect(adapter.provision({ runId: 'test-run', workspaceDir: tmpDir })).rejects.toThrow(
      'Dynamic env calculation failed',
    )
  })
})
