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

function makeTimedOutEnv(stdout = 'partial out', stderr = 'partial err'): ProvisionedEnvironment {
  return {
    __kind: 'environment',
    id: 'mock-env',
    type: 'mock',
    workingDir: '/workspace',
    exec: async () => ({
      exitCode: null,
      stdout,
      stderr,
      timedOut: true,
    }),
    ping: async () => true,
    teardown: async () => {},
  }
}

describe('execGuardrail timeout resolution (AC 5.2.2)', () => {
  it('resolves with fail status and Command timed out by default', async () => {
    const rail = execGuardrail({ command: 'sleep 10' })
    const verdict = await rail.execute({
      ctx: makeMockCtx(),
      stepId: 's-1',
      phase: 'afterStep',
      guardrailIndex: 0,
      attempt: 1,
      runDir: '/runs/1',
      environment: makeTimedOutEnv(),
      mcpServerUrl: '',
      mcpAuthToken: '',
    })

    expect(verdict.status).toBe('fail')
    expect(verdict.body).toBe('Command timed out')
    expect(verdict.rawLog).toBe('partial out\npartial err')
  })

  it('respects custom onTimeout status skip or pass', async () => {
    const skipRail = execGuardrail({ command: 'sleep 10', onTimeout: 'skip' })
    const skipVerdict = await skipRail.execute({
      ctx: makeMockCtx(),
      stepId: 's-1',
      phase: 'afterStep',
      guardrailIndex: 0,
      attempt: 1,
      runDir: '/runs/1',
      environment: makeTimedOutEnv(),
      mcpServerUrl: '',
      mcpAuthToken: '',
    })
    expect(skipVerdict.status).toBe('skip')
    expect(skipVerdict.body).toBe('Command timed out')

    const passRail = execGuardrail({ command: 'sleep 10', onTimeout: 'pass' })
    const passVerdict = await passRail.execute({
      ctx: makeMockCtx(),
      stepId: 's-1',
      phase: 'afterStep',
      guardrailIndex: 0,
      attempt: 1,
      runDir: '/runs/1',
      environment: makeTimedOutEnv(),
      mcpServerUrl: '',
      mcpAuthToken: '',
    })
    expect(passVerdict.status).toBe('pass')
  })
})
