import type {
  AgentRunner,
  AgentTurnInput,
  GuardrailExecutionInput,
  ProvisionedEnvironment,
  StepContext,
} from '@ludd/core'
import { describe, expect, it } from 'vitest'
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

function createExecutionInput(
  overrides?: Partial<GuardrailExecutionInput>,
): GuardrailExecutionInput {
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
    ...overrides,
  }
}

describe('agentGuardrail execution: sessionId and mode', () => {
  it('generates a fresh sessionId on every invocation', async () => {
    const sessionIds: string[] = []
    const agent: AgentRunner<any, any> = {
      __kind: 'agent',
      mode: 'read-only',
      prompt: 'p',
      executeTurn: async (turnInput: AgentTurnInput) => {
        sessionIds.push(turnInput.sessionId)
        return {
          output: { status: 'pass' },
          sessionId: turnInput.sessionId,
        }
      },
    }

    const rail = agentGuardrail({ agent, prompt: 'Review' })
    await rail.execute(createExecutionInput())
    await rail.execute(createExecutionInput())

    expect(sessionIds.length).toBe(2)
    expect(sessionIds[0]).toMatch(/^guardrail-session-[0-9a-f-]{36}$/)
    expect(sessionIds[1]).toMatch(/^guardrail-session-[0-9a-f-]{36}$/)
    expect(sessionIds[0]).not.toBe(sessionIds[1])
  })

  it('defaults mode to "read-only" and allows "workspace-write"', async () => {
    let capturedMode = ''
    const agent: AgentRunner<any, any> = {
      __kind: 'agent',
      mode: 'read-only',
      prompt: 'p',
      executeTurn: async (turnInput: AgentTurnInput) => {
        capturedMode = turnInput.mode
        return {
          output: { status: 'pass' },
          sessionId: turnInput.sessionId,
        }
      },
    }

    const defaultRail = agentGuardrail({ agent, prompt: 'p' })
    await defaultRail.execute(createExecutionInput())
    expect(capturedMode).toBe('read-only')

    const writeRail = agentGuardrail({ agent, prompt: 'p', mode: 'workspace-write' })
    await writeRail.execute(createExecutionInput())
    expect(capturedMode).toBe('workspace-write')
  })
})

describe('agentGuardrail execution: environment handling', () => {
  it('reuses parent step environment by default', async () => {
    let capturedEnv: ProvisionedEnvironment | undefined
    const agent: AgentRunner<any, any> = {
      __kind: 'agent',
      mode: 'read-only',
      prompt: 'p',
      executeTurn: async (turnInput: AgentTurnInput) => {
        capturedEnv = turnInput.environment
        return {
          output: { status: 'pass' },
          sessionId: turnInput.sessionId,
        }
      },
    }

    const rail = agentGuardrail({ agent, prompt: 'p' })
    await rail.execute(createExecutionInput({ environment: mockEnv }))
    expect(capturedEnv).toBe(mockEnv)
  })

  it('uses custom static or dynamic environment when configured', async () => {
    const customEnv: ProvisionedEnvironment = { ...mockEnv, id: 'custom-env' }
    let capturedEnv: ProvisionedEnvironment | undefined
    const agent: AgentRunner<any, any> = {
      __kind: 'agent',
      mode: 'read-only',
      prompt: 'p',
      executeTurn: async (turnInput: AgentTurnInput) => {
        capturedEnv = turnInput.environment
        return {
          output: { status: 'pass' },
          sessionId: turnInput.sessionId,
        }
      },
    }

    const staticRail = agentGuardrail({ agent, prompt: 'p', environment: customEnv })
    await staticRail.execute(createExecutionInput())
    expect(capturedEnv?.id).toBe('custom-env')

    const dynamicRail = agentGuardrail({
      agent,
      prompt: 'p',
      environment: () => customEnv,
    })
    await dynamicRail.execute(createExecutionInput())
    expect(capturedEnv?.id).toBe('custom-env')
  })
})

describe('agentGuardrail execution: MCP context', () => {
  it('passes mcpServerUrl and mcpAuthToken to agent.executeTurn', async () => {
    let capturedUrl = ''
    let capturedToken = ''
    const agent: AgentRunner<any, any> = {
      __kind: 'agent',
      mode: 'read-only',
      prompt: 'p',
      executeTurn: async (turnInput: AgentTurnInput) => {
        capturedUrl = turnInput.mcpServerUrl
        capturedToken = turnInput.mcpAuthToken
        return {
          output: { status: 'pass' },
          sessionId: turnInput.sessionId,
        }
      },
    }

    const rail = agentGuardrail({ agent, prompt: 'p' })
    await rail.execute(createExecutionInput({
      mcpServerUrl: 'http://test-server:3000',
      mcpAuthToken: 'secret-xyz',
    }))

    expect(capturedUrl).toBe('http://test-server:3000')
    expect(capturedToken).toBe('secret-xyz')
  })
})

describe('agentGuardrail execution: prompt resolution', () => {
  it('resolves prompt dynamically', async () => {
    let capturedPrompt = ''
    const agent: AgentRunner<any, any> = {
      __kind: 'agent',
      mode: 'read-only',
      prompt: 'p',
      executeTurn: async (turnInput: AgentTurnInput) => {
        capturedPrompt = turnInput.prompt
        return {
          output: { status: 'pass' },
          sessionId: turnInput.sessionId,
        }
      },
    }

    const dynamicRail = agentGuardrail({
      agent,
      prompt: ctx => `Review step ${ctx.step.id}`,
    })
    await dynamicRail.execute(createExecutionInput())
    expect(capturedPrompt).toBe('Review step step-1')
  })

  it('rejects empty resolved prompt', async () => {
    const agent: AgentRunner<any, any> = {
      __kind: 'agent',
      mode: 'read-only',
      prompt: 'p',
      executeTurn: async (turnInput: AgentTurnInput) => ({
        output: { status: 'pass' },
        sessionId: turnInput.sessionId,
      }),
    }

    const emptyRail = agentGuardrail({
      agent,
      prompt: () => '   ',
    })
    await expect(async () => emptyRail.execute(createExecutionInput())).rejects.toThrow(
      new TypeError('agentGuardrail prompt cannot be empty.'),
    )
  })
})
