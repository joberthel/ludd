import type { AgentTurnInput, StepContext } from '@ludd/core'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { isAgentRunner, runHarness } from '@ludd/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mockAgent } from './mock-agent.js'

describe('mockAgent creation and configuration', () => {
  it('creates an agent runner matching isAgentRunner contract', () => {
    const agent = mockAgent({
      prompt: 'test prompt',
      responses: ['first response'],
    })
    expect(isAgentRunner(agent)).toBe(true)
    expect(agent.__kind).toBe('agent')
    expect(agent.mode).toBe('read-only')
    expect(agent.prompt).toBe('test prompt')
    expect(agent.sessionId).toBeUndefined()
  })

  it('supports custom mode and custom sessionId', () => {
    const agent = mockAgent({
      mode: 'workspace-write',
      prompt: () => 'dynamic prompt',
      sessionId: 'session-xyz',
      responses: ['ok'],
    })
    expect(agent.mode).toBe('workspace-write')
    expect(agent.sessionId).toBe('session-xyz')
    expect(typeof agent.prompt).toBe('function')
  })

  it('rejects empty or non-array responses configuration', () => {
    expect(() => mockAgent({ prompt: 'test', responses: [] } as any)).toThrow(
      'mockAgent requires a non-empty "responses" array.',
    )
    expect(() => mockAgent({ prompt: 'test' } as any)).toThrow(
      'mockAgent requires a non-empty "responses" array.',
    )
    expect(() => mockAgent(null as any)).toThrow(
      'mockAgent requires a non-empty "responses" array.',
    )
  })
})

describe('mockAgent turn execution and response exhaustion', () => {
  const dummyInput: AgentTurnInput = {
    ctx: {
      runId: 'r-1',
      environments: {},
      steps: {},
      step: { id: 's-1', output: undefined, attempt: 1 },
      matrix: undefined,
      artifacts: {},
    },
    stepId: 's-1',
    prompt: 'hello',
    sessionId: 'sess-1',
    attempt: 1,
    mode: 'read-only',
    runDir: '/tmp/run',
  }

  it('sequentially consumes static values and function responses', async () => {
    const agent = mockAgent<string>({
      prompt: 'hello',
      responses: [
        'turn-1-value',
        async input => `turn-2-${input.stepId}-${input.prompt}`,
      ],
    })

    const turn1 = await agent.executeTurn(dummyInput)
    expect(turn1).toEqual({ output: 'turn-1-value', sessionId: 'sess-1' })

    const turn2 = await agent.executeTurn(dummyInput)
    expect(turn2).toEqual({
      output: 'turn-2-s-1-hello',
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

describe('mockAgent mixed workflow execution inside runHarness', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-mock-agent-mixed-'))
  })
  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('executes mixed workflow with mockAgent and TypeScript callbacks (AC 3.1.2)', async () => {
    const executionOrder: string[] = []
    const agent = mockAgent<{ analysis: string }>({
      prompt: 'Analyze data',
      responses: [
        { analysis: 'all good' },
      ],
    })

    const result = await runHarness({
      name: 'mixed-workflow',
      steps: [
        {
          id: 'step-ts-prep',
          run: () => {
            executionOrder.push('prep')
            return { prepared: true }
          },
        },
        {
          id: 'step-agent-analysis',
          run: agent,
        },
        {
          id: 'step-ts-post',
          run: (ctx) => {
            executionOrder.push('post')
            const analysis = (ctx.steps['step-agent-analysis']?.output as { analysis: string })?.analysis
            return `final: ${analysis}`
          },
        },
      ],
    }, { workspaceDir: tempDir })

    expect(result.status).toBe('passed')
    expect(executionOrder).toEqual(['prep', 'post'])
    expect(result.steps['step-ts-prep']?.output).toEqual({ prepared: true })
    expect(result.steps['step-agent-analysis']?.output).toEqual({ analysis: 'all good' })
    expect(result.steps['step-ts-post']?.output).toBe('final: all good')
  })
})

describe('mockAgent dynamic prompt resolution inside runHarness', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-mock-agent-prompt-'))
  })
  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('resolves dynamic prompt callback before executeTurn (AC 3.1.3)', async () => {
    let observedPrompt: string | undefined
    const agent = mockAgent<{ summary: string }>({
      prompt: (ctx: StepContext) => `Summary: ${(ctx.steps['step-1']?.output as { text: string }).text}`,
      responses: [
        (input) => {
          observedPrompt = input.prompt
          return { summary: `done-${input.prompt}` }
        },
      ],
    })

    const result = await runHarness({
      name: 'dynamic-prompt-harness',
      steps: [
        {
          id: 'step-1',
          run: () => ({ text: 'ludd agent test' }),
        },
        {
          id: 'step-2',
          run: agent,
        },
      ],
    }, { workspaceDir: tempDir })

    expect(result.status).toBe('passed')
    expect(observedPrompt).toBe('Summary: ludd agent test')
    expect(result.steps['step-2']?.output).toEqual({ summary: 'done-Summary: ludd agent test' })
  })
})

describe('mockAgent schema validation inside runHarness', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-mock-agent-schema-'))
  })
  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('validates mockAgent output against outputSchema', async () => {
    const schema = {
      safeParseAsync: async (val: unknown) => {
        if (typeof val === 'object' && val !== null && 'confidence' in val && (val as any).confidence >= 0.5) {
          return { success: true as const, data: val as { confidence: number } }
        }
        return {
          success: false as const,
          error: {
            issues: [
              { message: 'invalid' },
            ],
          },
        }
      },
    }
    const agent = mockAgent({
      prompt: 'calculate confidence',
      responses: [
        { confidence: 0.95 },
      ],
    })

    const result = await runHarness({
      name: 'schema-validation-harness',
      steps: [
        {
          id: 'agent-step',
          outputSchema: schema as any,
          run: agent,
        },
      ],
    }, { workspaceDir: tempDir })

    expect(result.status).toBe('passed')
    expect(result.steps['agent-step']?.output).toEqual({ confidence: 0.95 })
  })
})
