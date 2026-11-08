import type { StepContext } from '@ludd/core'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { readRunState, resolveRunDir, runHarness } from '@ludd/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mockAgent } from '../mock-agent.js'

describe('mockAgent automatic sessionId generation (AC 3.2.1)', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-mock-sess-gen-'))
  })
  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('generates session-<uuid> and persists it on step output and state.json', async () => {
    const agent = mockAgent<{ reply: string }>({
      prompt: 'say hello',
      responses: [
        { reply: 'hello world' },
      ],
    })

    const result = await runHarness({
      name: 'agent-auto-session',
      steps: [
        { id: 'step-1', run: agent },
      ],
    }, { workspaceDir: tempDir })

    expect(result.status).toBe('passed')
    const stepOutput = result.steps['step-1']?.output as { reply: string, sessionId: string }
    expect(stepOutput.reply).toBe('hello world')
    expect(stepOutput.sessionId).toMatch(/^session-[0-9a-f-]+$/)

    const runDir = resolveRunDir(tempDir, result.runId)
    const state = readRunState(runDir)
    const persisted = state.steps['step-1']?.output as { reply: string, sessionId: string }
    expect(persisted.sessionId).toBe(stepOutput.sessionId)
  })
})

describe('mockAgent cross-step session resumption (AC 3.2.2)', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-mock-sess-res-'))
  })
  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('passes upstream sessionId to downstream mockAgent turn', async () => {
    let capturedStep2SessionId: string | undefined

    const step1Agent = mockAgent<{ message: string }>({
      prompt: 'Start thread',
      responses: [
        { message: 'Thread started' },
      ],
    })

    const step2Agent = mockAgent<{ reply: string }>({
      prompt: 'Continue thread',
      sessionId: (ctx: StepContext) => (ctx.steps['step-1']?.output as { sessionId: string }).sessionId,
      responses: [
        (input) => {
          capturedStep2SessionId = input.sessionId
          return { reply: `Got session ${input.sessionId}` }
        },
      ],
    })

    const result = await runHarness({
      name: 'cross-step-resumption',
      steps: [
        { id: 'step-1', run: step1Agent },
        { id: 'step-2', run: step2Agent },
      ],
    }, { workspaceDir: tempDir })

    expect(result.status).toBe('passed')
    const step1Output = result.steps['step-1']?.output as { message: string, sessionId: string }
    expect(capturedStep2SessionId).toBe(step1Output.sessionId)

    const step2Output = result.steps['step-2']?.output as { reply: string, sessionId: string }
    expect(step2Output.sessionId).toBe(step1Output.sessionId)
    expect(step2Output.reply).toBe(`Got session ${step1Output.sessionId}`)
  })
})
