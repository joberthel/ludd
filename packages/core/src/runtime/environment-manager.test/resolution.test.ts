import type { StepContext } from '../../types/context.js'
import type { ProvisionedEnvironment } from '../../types/environment.js'
import type { Guardrail } from '../../types/guardrail.js'
import type { StepConfig } from '../../types/harness.js'
import { describe, expect, it } from 'vitest'
import {
  resolveGuardrailEnvironment,
  resolveStepEnvironment,
} from '../environment-manager.js'

function makeMockCtx(): StepContext {
  return {
    runId: 'run-1',
    environments: {},
    steps: {},
    step: { id: 'step-1', output: undefined, attempt: 1 },
    matrix: undefined,
    artifacts: {} as any,
  }
}

function makeMockEnv(id = 'mock-env'): ProvisionedEnvironment {
  return {
    __kind: 'environment',
    id,
    type: 'mock',
    workingDir: '/mock/path',
    exec: async () => ({
      exitCode: 0,
      stdout: '',
      stderr: '',
      timedOut: false,
    }),
    ping: async () => true,
    teardown: async () => {},
  }
}

describe('resolveStepEnvironment', () => {
  it('resolves provided step environment and registers in ctx.environments', async () => {
    const ctx = makeMockCtx()
    const customEnv = makeMockEnv('custom-env')
    const step: StepConfig = {
      id: 'step-custom',
      environment: customEnv,
      run: () => {},
    }

    const resolved = await resolveStepEnvironment(step, ctx, '/workspace')
    expect(resolved).toBe(customEnv)
    expect(ctx.environments['custom-env']).toBe(customEnv)
  })

  it('resolves dynamic function step environment', async () => {
    const ctx = makeMockCtx()
    const dynamicEnv = makeMockEnv('dynamic-env')
    const step: StepConfig = {
      id: 'step-dynamic',
      environment: () => dynamicEnv,
      run: () => {},
    }

    const resolved = await resolveStepEnvironment(step, ctx, '/workspace')
    expect(resolved).toBe(dynamicEnv)
    expect(ctx.environments['dynamic-env']).toBe(dynamicEnv)
  })

  it('defaults to host environment when step.environment is omitted', async () => {
    const ctx = makeMockCtx()
    const step: StepConfig = {
      id: 'step-default',
      run: () => {},
    }

    const resolved = await resolveStepEnvironment(step, ctx, '/workspace')
    expect(resolved.id).toBe('host')
    expect(resolved.type).toBe('host')
    expect(ctx.environments.host).toBe(resolved)
  })

  it('throws when step.environment resolves to invalid environment', async () => {
    const ctx = makeMockCtx()
    const step: StepConfig = {
      id: 'step-bad',
      environment: { notAnEnv: true } as any,
      run: () => {},
    }

    await expect(resolveStepEnvironment(step, ctx, '/workspace')).rejects.toThrow(
      'Step "step-bad" environment must resolve to a valid ProvisionedEnvironment.',
    )
  })
})

describe('resolveGuardrailEnvironment', () => {
  it('inherits step environment when guardrail.environment is omitted', async () => {
    const ctx = makeMockCtx()
    const stepEnv = makeMockEnv('step-env')
    const guardrail: Guardrail = {
      __kind: 'guardrail',
      type: 'fn',
      execute: async () => ({ status: 'pass' }),
    }

    const resolved = await resolveGuardrailEnvironment(guardrail, ctx, stepEnv)
    expect(resolved).toBe(stepEnv)
  })

  it('resolves overridden guardrail environment', async () => {
    const ctx = makeMockCtx()
    const stepEnv = makeMockEnv('step-env')
    const railEnv = makeMockEnv('rail-override')
    const guardrail: Guardrail = {
      __kind: 'guardrail',
      type: 'fn',
      environment: railEnv,
      execute: async () => ({ status: 'pass' }),
    }

    const resolved = await resolveGuardrailEnvironment(guardrail, ctx, stepEnv)
    expect(resolved).toBe(railEnv)
  })

  it('throws when guardrail.environment resolves to invalid environment', async () => {
    const ctx = makeMockCtx()
    const stepEnv = makeMockEnv('step-env')
    const guardrail: Guardrail = {
      __kind: 'guardrail',
      type: 'fn',
      environment: { notAnEnv: true } as any,
      execute: async () => ({ status: 'pass' }),
    }

    await expect(resolveGuardrailEnvironment(guardrail, ctx, stepEnv)).rejects.toThrow(
      'Guardrail environment must resolve to a valid ProvisionedEnvironment.',
    )
  })
})
