import type {
  AgentRunner,
  AgentTurnInput,
  GuardrailExecutionInput,
  StepContext,
} from '@luddjs/core'
import path from 'node:path'
import { StepOutputValidationError } from '@luddjs/core'
import { describe, expect, it } from 'vitest'
import { agentGuardrail } from '../agent-guardrail.js'

function createDummyContext(): StepContext {
  return {
    runId: 'run-1',
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
    cwd: '/workspace',
    env: { BASE: '1' },
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

describe('agentGuardrail execution: cwd, env, and signal handling', () => {
  it('forwards parent step cwd, env, and signal by default', async () => {
    let capturedTurn: AgentTurnInput | undefined
    const controller = new AbortController()
    const agent: AgentRunner<any, any> = {
      __kind: 'agent',
      mode: 'read-only',
      prompt: 'p',
      executeTurn: async (turnInput: AgentTurnInput) => {
        capturedTurn = turnInput
        return {
          output: { status: 'pass' },
          sessionId: turnInput.sessionId,
        }
      },
    }

    const rail = agentGuardrail({ agent, prompt: 'p' })
    await rail.execute(createExecutionInput({
      cwd: '/workspace/wt',
      env: { STEP: 'yes' },
      signal: controller.signal,
    }))
    expect(capturedTurn?.cwd).toBe('/workspace/wt')
    expect(capturedTurn?.env).toEqual({ STEP: 'yes' })
    expect(capturedTurn?.signal).toBe(controller.signal)
  })

  it('applies static and dynamic cwd and env overrides when configured', async () => {
    let capturedTurn: AgentTurnInput | undefined
    const agent: AgentRunner<any, any> = {
      __kind: 'agent',
      mode: 'read-only',
      prompt: 'p',
      executeTurn: async (turnInput: AgentTurnInput) => {
        capturedTurn = turnInput
        return {
          output: { status: 'pass' },
          sessionId: turnInput.sessionId,
        }
      },
    }

    const staticRail = agentGuardrail({
      agent,
      prompt: 'p',
      cwd: 'packages/core',
      env: { EXTRA: 'static' },
    })
    await staticRail.execute(createExecutionInput())
    expect(capturedTurn?.cwd).toBe(path.resolve('/workspace/packages/core'))
    expect(capturedTurn?.env).toEqual({ BASE: '1', EXTRA: 'static' })

    const dynamicRail = agentGuardrail({
      agent,
      prompt: 'p',
      cwd: ctx => `/custom/${ctx.step.id}`,
      env: () => ({ BASE: 'override', DYN: '1' }),
    })
    await dynamicRail.execute(createExecutionInput())
    expect(capturedTurn?.cwd).toBe(path.resolve('/custom/step-1'))
    expect(capturedTurn?.env).toEqual({ BASE: 'override', DYN: '1' })
  })
})

describe('agentGuardrail execution: MCP context', () => {
  it('passes mcp connection info to agent.executeTurn when configured and omits when empty', async () => {
    const capturedMcp: Array<AgentTurnInput['mcp']> = []
    const agent: AgentRunner<any, any> = {
      __kind: 'agent',
      mode: 'read-only',
      prompt: 'p',
      executeTurn: async (turnInput: AgentTurnInput) => {
        capturedMcp.push(turnInput.mcp)
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
    await rail.execute(createExecutionInput({
      mcpServerUrl: '',
      mcpAuthToken: '',
    }))

    expect(capturedMcp).toEqual([
      { url: 'http://test-server:3000', authToken: 'secret-xyz' },
      undefined,
    ])
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

  it('throws abort error rather than StepOutputValidationError when signal aborts mid-turn', async () => {
    const resolvedAbortCtrl = new AbortController()
    const resolvedAfterAbortAgent: AgentRunner<any, any> = {
      __kind: 'agent',
      mode: 'read-only',
      prompt: 'p',
      executeTurn: async (turnInput: AgentTurnInput) => {
        resolvedAbortCtrl.abort(new Error('guardrail-turn-aborted'))
        return { output: 'incomplete-non-verdict', sessionId: turnInput.sessionId }
      },
    }
    const rail1 = agentGuardrail({ agent: resolvedAfterAbortAgent, prompt: 'p' })
    await expect(
      rail1.execute(createExecutionInput({ signal: resolvedAbortCtrl.signal })),
    ).rejects.toThrow('guardrail-turn-aborted')

    const thrownAbortCtrl = new AbortController()
    const thrownValidationOnAbortAgent: AgentRunner<any, any> = {
      __kind: 'agent',
      mode: 'read-only',
      prompt: 'p',
      executeTurn: async () => {
        thrownAbortCtrl.abort(new Error('pi-turn-aborted'))
        throw new StepOutputValidationError('step-1', undefined, [
          {
            code: 'custom',
            path: ['status'],
            message: 'missing submission',
          },
        ])
      },
    }
    const rail2 = agentGuardrail({ agent: thrownValidationOnAbortAgent, prompt: 'p' })
    const err = await rail2
      .execute(createExecutionInput({ signal: thrownAbortCtrl.signal }))
      .catch((e: unknown) => e)
    expect(err).not.toBeInstanceOf(StepOutputValidationError)
    expect((err as Error).message).toBe('pi-turn-aborted')
  })
})
