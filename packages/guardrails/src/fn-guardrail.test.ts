import type { GuardrailExecutionInput, StepContext } from '@ludd/core'
import { isGuardrail } from '@ludd/core'
import { describe, expect, it } from 'vitest'
import { fnGuardrail } from './fn-guardrail.js'

function createFakeExecutionInput(ctx: StepContext): GuardrailExecutionInput {
  return {
    ctx,
    stepId: 'step-1',
    phase: 'afterStep',
    guardrailIndex: 0,
    attempt: 1,
    runDir: '/tmp/run',
    environment: { id: 'env-1' },
    mcpServerUrl: '',
    mcpAuthToken: '',
  }
}

describe('fnGuardrail config object', () => {
  it('creates a guardrail from a config object with run function', async () => {
    const rail = fnGuardrail({
      maxRetries: 2,
      onMaxRetriesExceeded: 'abort',
      run: async ctx => ({
        status: 'pass',
        body: { runId: ctx.runId },
      }),
    })

    expect(isGuardrail(rail)).toBe(true)
    expect(rail.__kind).toBe('guardrail')
    expect(rail.type).toBe('fn')
    expect(rail.maxRetries).toBe(2)
    expect(rail.onMaxRetriesExceeded).toBe('abort')

    const fakeCtx = {
      runId: 'r-123',
      environments: {},
      steps: {},
      step: {
        id: 'step-1',
        output: { value: 42 },
        attempt: 1,
      },
      matrix: undefined,
      artifacts: {} as any,
    } satisfies StepContext

    const verdict = await rail.execute(createFakeExecutionInput(fakeCtx))
    expect(verdict).toEqual({
      status: 'pass',
      body: { runId: 'r-123' },
    })
  })
})

describe('fnGuardrail shorthand and options', () => {
  it('creates a guardrail from shorthand function', async () => {
    const rail = fnGuardrail(ctx => ({
      status: 'fail',
      body: `Failed for ${ctx.step.id}`,
    }))

    expect(isGuardrail(rail)).toBe(true)
    expect(rail.type).toBe('fn')
    expect(rail.maxRetries).toBeUndefined()
    expect(rail.onMaxRetriesExceeded).toBeUndefined()

    const fakeCtx = {
      runId: 'r-123',
      environments: {},
      steps: {},
      step: { id: 'step-2', output: undefined, attempt: 1 },
      matrix: undefined,
      artifacts: {} as any,
    } satisfies StepContext

    const verdict = await rail.execute(createFakeExecutionInput(fakeCtx))
    expect(verdict).toEqual({ status: 'fail', body: 'Failed for step-2' })
  })

  it('preserves environment config when supplied', () => {
    const envProp = { id: 'custom-env' }
    const rail = fnGuardrail({
      environment: envProp,
      run: () => ({ status: 'skip' }),
    })
    expect(rail.environment).toBe(envProp)
  })
})

describe('fnGuardrail validation', () => {
  it('throws TypeError when config is not a valid object or function', () => {
    expect(() => fnGuardrail(null as any)).toThrow(TypeError)
    expect(() => fnGuardrail(undefined as any)).toThrow(TypeError)
    expect(() => fnGuardrail('not-object' as any)).toThrow(TypeError)
    expect(() => fnGuardrail([] as any)).toThrow(TypeError)
  })

  it('throws TypeError when run is not a function', () => {
    expect(() => fnGuardrail({ run: 'not-a-func' as any })).toThrow(TypeError)
    expect(() => fnGuardrail({} as any)).toThrow(TypeError)
  })

  it('throws TypeError when maxRetries is invalid', () => {
    expect(() => fnGuardrail({
      run: () => ({ status: 'pass' }),
      maxRetries: -1,
    })).toThrow(TypeError)
    expect(() => fnGuardrail({
      run: () => ({ status: 'pass' }),
      maxRetries: 1.5,
    })).toThrow(TypeError)
    expect(() => fnGuardrail({
      run: () => ({ status: 'pass' }),
      maxRetries: 'two' as any,
    })).toThrow(TypeError)
  })

  it('throws TypeError when onMaxRetriesExceeded is invalid', () => {
    expect(() => fnGuardrail({
      run: () => ({ status: 'pass' }),
      onMaxRetriesExceeded: 'invalid' as any,
    })).toThrow(TypeError)
  })

  it('accepts onMaxRetriesExceeded: prompt_user', () => {
    const rail = fnGuardrail({
      run: () => ({ status: 'pass' }),
      onMaxRetriesExceeded: 'prompt_user',
    })
    expect(rail.onMaxRetriesExceeded).toBe('prompt_user')
  })
})
