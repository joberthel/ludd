import type {
  AgentRunner,
  GuardrailExecutionInput,
  ProvisionedEnvironment,
  StepContext,
} from '@ludd/core'
import { StepOutputValidationError } from '@ludd/core'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { agentGuardrail } from '../agent-guardrail.js'

const mockEnv: ProvisionedEnvironment = {
  __kind: 'environment',
  id: 'mock-env',
  type: 'host',
  workingDir: '/workspace',
  exec: async () => ({
    exitCode: 0,
    stdout: '',
    stderr: '',
    timedOut: false,
  }),
  ping: async () => true,
  teardown: async () => {},
}

function createDummyContext(): StepContext {
  return {
    runId: 'run-1',
    environments: { host: mockEnv },
    steps: {},
    step: { id: 'step-1', output: undefined, attempt: 1 },
    matrix: undefined,
    artifacts: {} as any,
  }
}

function createExecutionInput(): GuardrailExecutionInput {
  return {
    ctx: createDummyContext(),
    stepId: 'step-1',
    phase: 'afterStep',
    guardrailIndex: 0,
    attempt: 1,
    runDir: '',
    environment: mockEnv,
    mcpServerUrl: 'http://127.0.0.1:4000',
    mcpAuthToken: 'token-abc',
  }
}

function makeAgent(output: unknown): AgentRunner<any, any> {
  return {
    __kind: 'agent',
    mode: 'read-only',
    prompt: 'p',
    executeTurn: async turnInput => ({
      output,
      sessionId: turnInput.sessionId,
    }),
  }
}

describe('agentGuardrail verdict: pass and skip statuses', () => {
  it('formats pass verdict without body', async () => {
    const passRail = agentGuardrail({
      agent: makeAgent({ status: 'pass' }),
      prompt: 'p',
    })
    const verdict = await passRail.execute(createExecutionInput())
    expect(verdict).toEqual({
      status: 'pass',
      body: undefined,
      pagination: undefined,
      logFormat: undefined,
    })
  })

  it('formats skip verdict with body', async () => {
    const skipRail = agentGuardrail({
      agent: makeAgent({
        status: 'skip',
        body: { skipped: true },
      }),
      prompt: 'p',
    })
    const verdict = await skipRail.execute(createExecutionInput())
    expect(verdict).toEqual({
      status: 'skip',
      body: { skipped: true },
      pagination: undefined,
      logFormat: undefined,
    })
  })

  it('preserves pagination and sets logFormat to json', async () => {
    const rail = agentGuardrail({
      agent: makeAgent({
        status: 'pass',
        body: ['item1'],
      }),
      prompt: 'p',
      pagination: 'findings',
    })
    const verdict = await rail.execute(createExecutionInput())
    expect(verdict.pagination).toBe('findings')
    expect(verdict.logFormat).toBe('json')
  })
})

describe('agentGuardrail verdict: fail status and body serialization', () => {
  it('formats fail status with object body as JSON rawLog', async () => {
    const failRail = agentGuardrail({
      agent: makeAgent({
        status: 'fail',
        body: {
          findings: ['Issue 1'],
        },
      }),
      prompt: 'p',
    })
    const verdict = await failRail.execute(createExecutionInput())
    expect(verdict).toEqual({
      status: 'fail',
      body: {
        findings: ['Issue 1'],
      },
      rawLog: JSON.stringify({
        findings: ['Issue 1'],
      }, null, 2),
      logFormat: 'json',
      pagination: undefined,
    })
  })

  it('formats fail status with string body as rawLog', async () => {
    const failStringRail = agentGuardrail({
      agent: makeAgent({ status: 'fail', body: 'Error message string' }),
      prompt: 'p',
    })
    const verdict = await failStringRail.execute(createExecutionInput())
    expect(verdict.rawLog).toBe('Error message string')
  })

  it('formats fail status with undefined body', async () => {
    const failUndefinedRail = agentGuardrail({
      agent: makeAgent({ status: 'fail' }),
      prompt: 'p',
    })
    const verdict = await failUndefinedRail.execute(createExecutionInput())
    expect(verdict.rawLog).toBeUndefined()
  })
})

describe('agentGuardrail verdict: validation errors and exceptions', () => {
  it('throws StepOutputValidationError when status is invalid', async () => {
    const rail = agentGuardrail({
      agent: makeAgent({ status: 'unknown' }),
      prompt: 'p',
    })
    await expect(rail.execute(createExecutionInput())).rejects.toThrow(
      StepOutputValidationError,
    )
  })

  it('throws StepOutputValidationError when body fails bodySchema', async () => {
    const schemaRail = agentGuardrail({
      agent: makeAgent({
        status: 'pass',
        body: { findings: 'should-be-array' },
      }),
      prompt: 'p',
      bodySchema: z.object({
        findings: z.array(z.string()),
      }),
    })
    await expect(schemaRail.execute(createExecutionInput())).rejects.toThrow(
      StepOutputValidationError,
    )
  })

  it('bubbles up error when agent.executeTurn throws', async () => {
    const failingAgent: AgentRunner<any, any> = {
      __kind: 'agent',
      mode: 'read-only',
      prompt: 'p',
      executeTurn: vi.fn().mockRejectedValue(new Error('Agent crashed')),
    }

    const rail = agentGuardrail({ agent: failingAgent, prompt: 'p' })
    await expect(rail.execute(createExecutionInput())).rejects.toThrow('Agent crashed')
  })
})
