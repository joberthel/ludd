import type { AgentTurnInput, GuardrailExecutionInput, ProvisionedEnvironment, StepContext } from '@ludd/core'
import { describe, expect, it, vi } from 'vitest'

const piAgentMock = vi.hoisted(() => vi.fn())
vi.mock('@ludd/agents', () => ({ piAgent: piAgentMock }))

const { agentGuardrail } = await import('../agent-guardrail.js')

const env = {
  __kind: 'environment',
  id: 'e',
  type: 'host',
  workingDir: '/w',
} as unknown as ProvisionedEnvironment

function input(): GuardrailExecutionInput {
  return {
    ctx: {
      runId: 'r',
      environments: { host: env },
      steps: {},
      step: { id: 's', attempt: 1 },
    } as unknown as StepContext,
    stepId: 's',
    phase: 'afterStep',
    guardrailIndex: 0,
    attempt: 1,
    runDir: '',
    environment: env,
    mcpServerUrl: '',
    mcpAuthToken: '',
  }
}

function fakeRunner(seen: AgentTurnInput[]) {
  return {
    __kind: 'agent',
    mode: 'read-only',
    prompt: 'p',
    executeTurn: async (turn: AgentTurnInput) => {
      seen.push(turn)
      return {
        output: { status: 'pass' },
        sessionId: turn.sessionId,
      }
    },
  }
}

describe('agentGuardrail default agent', () => {
  it('defaults to piAgent with mode, prompt, a fresh sessionId and the verdict schema', async () => {
    const seen: AgentTurnInput[] = []
    piAgentMock.mockImplementation(() => fakeRunner(seen))
    const rail = agentGuardrail({ prompt: 'Review' })
    await rail.execute(input())
    await rail.execute(input())

    expect(piAgentMock).toHaveBeenCalledTimes(2)
    const cfg = piAgentMock.mock.calls[0][0]
    expect(cfg.mode).toBe('read-only')
    expect(cfg.prompt).toBe('Review')
    expect(cfg.sessionId).toMatch(/^guardrail-session-/)
    expect(piAgentMock.mock.calls[1][0].sessionId).not.toBe(cfg.sessionId)
    expect(seen[0].outputSchema).toBeDefined()
  })

  it('does not use piAgent when an explicit agent is given', async () => {
    piAgentMock.mockClear()
    const seen: AgentTurnInput[] = []
    const rail = agentGuardrail({
      agent: fakeRunner(seen) as any,
      prompt: 'Review',
    })
    await rail.execute(input())
    expect(piAgentMock).not.toHaveBeenCalled()
    expect(seen).toHaveLength(1)
  })
})
