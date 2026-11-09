import type { ProvisionedEnvironment, StepContext } from '@ludd/core'
import { describe, expect, it } from 'vitest'
import { execGuardrail } from '../exec-guardrail.js'

function makeMockCtx(): StepContext {
  return {
    runId: 'r-1',
    environments: {},
    steps: {},
    step: { id: 's-1', output: undefined, attempt: 1 },
    matrix: undefined,
    artifacts: {} as any,
  }
}

function makeEnvWithResult(stdout: string, stderr = '', exitCode = 0): ProvisionedEnvironment {
  return {
    __kind: 'environment',
    id: 'mock-env',
    type: 'mock',
    workingDir: '/workspace',
    exec: async () => ({
      exitCode,
      stdout,
      stderr,
      timedOut: false,
    }),
    ping: async () => true,
    teardown: async () => {},
  }
}

describe('execGuardrail synchronous formatter', () => {
  it('allows custom sync formatter to override verdict status and body', async () => {
    const rail = execGuardrail({
      command: 'phpstan',
      formatter: (result) => {
        const parsed = JSON.parse(result.stdout)
        const status = parsed.totalErrors === 0
          ? 'pass'
          : 'fail'
        return {
          status,
          body: { errors: parsed.messages },
        }
      },
    })

    const payload = JSON.stringify({
      totalErrors: 2,
      messages: ['err1', 'err2'],
    })
    const env = makeEnvWithResult(payload, '', 1)
    const verdict = await rail.execute({
      ctx: makeMockCtx(),
      stepId: 's-1',
      phase: 'afterStep',
      guardrailIndex: 0,
      attempt: 1,
      runDir: '/runs/1',
      environment: env,
      mcpServerUrl: '',
      mcpAuthToken: '',
    })

    expect(verdict.status).toBe('fail')
    expect(verdict.body).toEqual({
      errors: ['err1', 'err2'],
    })
    expect(verdict.rawLog).toContain('totalErrors')
  })
})

describe('execGuardrail asynchronous formatter', () => {
  it('allows async formatter and respects custom rawLog and pagination', async () => {
    const rail = execGuardrail({
      command: 'test',
      pagination: 'original-page',
      formatter: async result => ({
        status: 'pass',
        rawLog: `custom log: ${result.stdout}`,
        pagination: 'custom-page',
      }),
    })

    const verdict = await rail.execute({
      ctx: makeMockCtx(),
      stepId: 's-1',
      phase: 'afterStep',
      guardrailIndex: 0,
      attempt: 1,
      runDir: '/runs/1',
      environment: makeEnvWithResult('output data'),
      mcpServerUrl: '',
      mcpAuthToken: '',
    })

    expect(verdict.status).toBe('pass')
    expect(verdict.rawLog).toBe('custom log: output data')
    expect(verdict.pagination).toBe('custom-page')
  })

  it('omits rawLog when formatter returns status pass without rawLog', async () => {
    const rail = execGuardrail({
      command: 'test',
      formatter: async () => ({
        status: 'pass',
      }),
    })

    const verdict = await rail.execute({
      ctx: makeMockCtx(),
      stepId: 's-1',
      phase: 'afterStep',
      guardrailIndex: 0,
      attempt: 1,
      runDir: '/runs/1',
      environment: makeEnvWithResult('some output'),
      mcpServerUrl: '',
      mcpAuthToken: '',
    })

    expect(verdict.status).toBe('pass')
    expect(verdict.rawLog).toBeUndefined()
  })
})
