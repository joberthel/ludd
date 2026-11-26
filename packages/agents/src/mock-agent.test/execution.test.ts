import type { AgentTurnInput, ArtifactClient } from '@luddjs/core'
import { describe, expect, it } from 'vitest'
import { mockAgent } from '../mock-agent.js'

const abortController = new AbortController()

const dummyInput: AgentTurnInput = {
  ctx: {
    runId: 'r-1',
    steps: {},
    step: { id: 's-1', output: undefined, attempt: 1 },
    matrix: undefined,
    artifacts: {} as ArtifactClient,
  },
  stepId: 's-1',
  prompt: 'hello',
  sessionId: 'sess-1',
  attempt: 1,
  mode: 'read-only',
  runDir: '/tmp/run',
  cwd: '/tmp/worktree',
  env: { WORKTREE: '1' },
  signal: abortController.signal,
  mcp: {
    url: 'http://127.0.0.1:0/mcp',
    authToken: 'dummy-token',
  },
}

describe('mockAgent turn execution and response exhaustion', () => {
  it('sequentially consumes static values and function responses with cwd, env, and signal', async () => {
    const agent = mockAgent<string>({
      prompt: 'hello',
      responses: [
        'turn-1-value',
        async input => `turn-2-${input.stepId}-${input.prompt}-${input.cwd}-${input.env.WORKTREE}-${input.signal === abortController.signal}`,
      ],
    })

    const turn1 = await agent.executeTurn(dummyInput)
    expect(turn1).toEqual({ output: 'turn-1-value', sessionId: 'sess-1' })

    const turn2 = await agent.executeTurn(dummyInput)
    expect(turn2).toEqual({
      output: 'turn-2-s-1-hello-/tmp/worktree-1-true',
      sessionId: 'sess-1',
    })
  })

  it('throws descriptive error when responses are exhausted (AC 3.1.4)', async () => {
    const agent = mockAgent({
      prompt: 'hello',
      responses: ['single-response'],
    })

    await agent.executeTurn(dummyInput)
    await expect(agent.executeTurn(dummyInput)).rejects.toThrow(
      'mockAgent scripted responses exhausted: received call 2 but only 1 responses configured.',
    )
  })
})
