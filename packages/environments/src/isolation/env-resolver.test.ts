import type { StepContext } from '@ludd/core'
import process from 'node:process'
import { describe, expect, it } from 'vitest'
import { resolveEnvironmentVariables } from './env-resolver.js'

describe('resolveEnvironmentVariables basic resolution', () => {
  it('returns empty object when neither env nor ephemeralPorts is specified', async () => {
    const res = await resolveEnvironmentVariables({})
    expect(res).toEqual({})
  })

  it('allocates ephemeral ports and maps them to string env vars', async () => {
    const res = await resolveEnvironmentVariables({
      ephemeralPorts: ['APP_PORT', 'REDIS_PORT'],
    })
    expect(res.ephemeralPorts).toBeDefined()
    expect(typeof res.ephemeralPorts?.APP_PORT).toBe('number')
    expect(typeof res.ephemeralPorts?.REDIS_PORT).toBe('number')
    expect(res.ephemeralPorts?.APP_PORT).toBeGreaterThan(1024)
    expect(res.ephemeralPorts?.REDIS_PORT).toBeGreaterThan(1024)

    expect(res.injectedEnv).toEqual({
      APP_PORT: String(res.ephemeralPorts?.APP_PORT),
      REDIS_PORT: String(res.ephemeralPorts?.REDIS_PORT),
    })
  })

  it('resolves static environment object', async () => {
    const res = await resolveEnvironmentVariables({
      env: { DB_NAME: 'test_db', API_KEY: 'secret' },
    })
    expect(res.ephemeralPorts).toBeUndefined()
    expect(res.injectedEnv).toEqual({
      DB_NAME: 'test_db',
      API_KEY: 'secret',
    })
  })

  it('ignores empty ephemeralPorts array', async () => {
    const res = await resolveEnvironmentVariables({
      ephemeralPorts: [],
    })
    expect(res).toEqual({})
  })
})

describe('resolveEnvironmentVariables dynamic env callbacks', () => {
  it('resolves dynamic env callback using context.ctx when present', async () => {
    const mockCtx = {
      runId: 'run-999',
      step: { attempt: 1, id: 'step-db', output: undefined },
    } as unknown as StepContext

    const res = await resolveEnvironmentVariables(
      {
        env: (ctx: StepContext) => ({
          ACTIVE_STEP: ctx.step.id,
          DB_DATABASE: `test_run_${ctx.runId}`,
        }),
      },
      {
        ctx: mockCtx,
        runId: 'run-999',
        workspaceDir: '/custom/workspace',
      },
    )

    expect(res.injectedEnv).toEqual({
      ACTIVE_STEP: 'step-db',
      DB_DATABASE: 'test_run_run-999',
    })
  })

  it('resolves dynamic env callback falling back when context.ctx is absent', async () => {
    const res = await resolveEnvironmentVariables(
      {
        env: (ctx: any) => ({
          DB_DATABASE: `test_run_${ctx.runId}`,
        }),
      },
      {
        runId: 'run-fallback',
        workspaceDir: '/fallback/dir',
      },
    )

    expect(res.injectedEnv).toEqual({
      DB_DATABASE: 'test_run_run-fallback',
    })

    const resDefault = await resolveEnvironmentVariables({
      env: (ctx: any) => ({
        CWD: ctx.workspaceDir,
        RUN_ID: ctx.runId,
      }),
    })
    expect(resDefault.injectedEnv?.RUN_ID).toBe('host')
    expect(resDefault.injectedEnv?.CWD).toBe(process.cwd())
  })
})

describe('resolveEnvironmentVariables combinations', () => {
  it('combines dynamic env callback and ephemeral ports into injectedEnv', async () => {
    const res = await resolveEnvironmentVariables(
      {
        env: (ctx: any) => ({
          SERVICE_URL: `http://localhost:${ctx.runId}`,
        }),
        ephemeralPorts: ['APP_PORT'],
      },
      {
        runId: 'run-combo',
      },
    )

    expect(res.ephemeralPorts?.APP_PORT).toBeDefined()
    expect(res.injectedEnv?.APP_PORT).toBe(String(res.ephemeralPorts?.APP_PORT))
    expect(res.injectedEnv?.SERVICE_URL).toBe('http://localhost:run-combo')
  })
})
