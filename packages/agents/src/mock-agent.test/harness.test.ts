import type { StepContext } from '@ludd/core'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { runHarness } from '@ludd/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mockAgent } from '../mock-agent.js'

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
    expect(result.steps['step-agent-analysis']?.output).toEqual({
      analysis: 'all good',
      sessionId: expect.stringMatching(/^session-[0-9a-f-]+$/),
    })
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
    expect(result.steps['step-2']?.output).toEqual({
      summary: 'done-Summary: ludd agent test',
      sessionId: expect.stringMatching(/^session-[0-9a-f-]+$/),
    })
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
    expect(result.steps['agent-step']?.output).toEqual({
      confidence: 0.95,
      sessionId: expect.stringMatching(/^session-[0-9a-f-]+$/),
    })
  })
})
