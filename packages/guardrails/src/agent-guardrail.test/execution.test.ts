import type {
  AgentTurnInput,
  GuardrailExecutionInput,
  StepContext,
} from '@luddjs/core'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { acpAgent, mockAgent } from '@luddjs/agents'
import { StepOutputValidationError } from '@luddjs/core'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
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
    const recordSession = (turnInput: AgentTurnInput) => {
      sessionIds.push(turnInput.sessionId)
      return { status: 'pass' }
    }
    const agent = mockAgent({
      prompt: 'p',
      responses: [recordSession, recordSession],
    })

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
    const recordMode = (turnInput: AgentTurnInput) => {
      capturedMode = turnInput.mode
      return { status: 'pass' }
    }
    const agent = mockAgent({
      prompt: 'p',
      responses: [recordMode, recordMode],
    })

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
    const agent = mockAgent({
      prompt: 'p',
      responses: [
        (turnInput) => {
          capturedTurn = turnInput
          return { status: 'pass' }
        },
      ],
    })

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
    const captureTurn = (turnInput: AgentTurnInput) => {
      capturedTurn = turnInput
      return { status: 'pass' }
    }
    const agent = mockAgent({
      prompt: 'p',
      responses: [captureTurn, captureTurn],
    })

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
    const recordMcp = (turnInput: AgentTurnInput) => {
      capturedMcp.push(turnInput.mcp)
      return { status: 'pass' }
    }
    const agent = mockAgent({
      prompt: 'p',
      responses: [recordMcp, recordMcp],
    })

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

describe('agentGuardrail execution: prompt resolution and ACP runner', () => {
  it('resolves prompt dynamically', async () => {
    let capturedPrompt = ''
    const agent = mockAgent({
      prompt: 'p',
      responses: [
        (turnInput) => {
          capturedPrompt = turnInput.prompt
          return { status: 'pass' }
        },
      ],
    })

    const dynamicRail = agentGuardrail({
      agent,
      prompt: ctx => `Review step ${ctx.step.id}`,
    })
    await dynamicRail.execute(createExecutionInput())
    expect(capturedPrompt).toBe('Review step step-1')
  })

  it('rejects empty resolved prompt', async () => {
    const agent = mockAgent({
      prompt: 'p',
      responses: [
        { status: 'pass' },
      ],
    })

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
    const resolvedAfterAbortAgent = mockAgent({
      prompt: 'p',
      responses: [
        () => {
          resolvedAbortCtrl.abort(new Error('guardrail-turn-aborted'))
          return 'incomplete-non-verdict'
        },
      ],
    })
    const rail1 = agentGuardrail({ agent: resolvedAfterAbortAgent, prompt: 'p' })
    await expect(
      rail1.execute(createExecutionInput({ signal: resolvedAbortCtrl.signal })),
    ).rejects.toThrow('guardrail-turn-aborted')

    const thrownAbortCtrl = new AbortController()
    const thrownValidationOnAbortAgent = mockAgent({
      prompt: 'p',
      responses: [
        () => {
          thrownAbortCtrl.abort(new Error('agent-turn-aborted'))
          throw new StepOutputValidationError('step-1', undefined, [
            {
              code: 'custom',
              path: ['status'],
              message: 'missing submission',
            },
          ])
        },
      ],
    })
    const rail2 = agentGuardrail({ agent: thrownValidationOnAbortAgent, prompt: 'p' })
    const err = await rail2
      .execute(createExecutionInput({ signal: thrownAbortCtrl.signal }))
      .catch((e: unknown) => e)
    expect(err).not.toBeInstanceOf(StepOutputValidationError)
    expect((err as Error).message).toBe('agent-turn-aborted')
  })

  it('executes seamlessly with an explicit acpAgent runner', async () => {
    const fakeAcpScript = [
      'import readline from "node:readline";',
      'const rl = readline.createInterface({ input: process.stdin });',
      'const send = (m) => process.stdout.write(JSON.stringify(m) + "\\n");',
      'rl.on("line", (line) => {',
      '  if (!line.trim()) return;',
      '  const req = JSON.parse(line);',
      '  if (req.method === "initialize") send({ jsonrpc: "2.0", id: req.id, result: { protocolVersion: req.params.protocolVersion, agentCapabilities: {} } });',
      '  else if (req.method === "session/new") send({ jsonrpc: "2.0", id: req.id, result: { sessionId: "acp-sess-1" } });',
      '  else if (req.method === "session/prompt") {',
      '    send({ jsonrpc: "2.0", method: "session/update", params: { sessionId: "acp-sess-1", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "{\\"status\\":\\"pass\\",\\"body\\":{\\"checked\\":true}}" } } } });',
      '    send({ jsonrpc: "2.0", id: req.id, result: { stopReason: "end_turn" } });',
      '  }',
      '});',
    ].join('\n')

    const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-guardrail-acp-'))
    try {
      const rail = agentGuardrail({
        agent: acpAgent({
          command: process.execPath,
          args: ['--input-type=module', '-e', fakeAcpScript],
        }),
        bodySchema: z.object({
          checked: z.boolean(),
        }),
        prompt: 'Verify build with ACP agent',
      })

      const verdict = await rail.execute(createExecutionInput({
        runDir: tmpDir,
        cwd: tmpDir,
        mcpServerUrl: '',
        mcpAuthToken: '',
      }))
      expect(verdict).toEqual({
        status: 'pass',
        body: { checked: true },
        rawLog: undefined,
        logFormat: undefined,
        pagination: undefined,
      })
    }
    finally {
      await rm(tmpDir, { recursive: true, force: true })
    }
  })
})
