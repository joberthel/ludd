import type { AgentRunner } from '../../types/agent.js'
import type { StepContext } from '../../types/context.js'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readLedgerEvents } from '../../persistence/ledger-writer.js'
import { readRunState, resolveRunDir } from '../../persistence/state-store.js'
import { runHarness } from '../run-harness.js'

describe('runHarness automatic sessionId generation and persistence (AC 3.2.1)', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-agent-sess-gen-'))
  })
  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('generates session-<uuid> when sessionId is omitted and persists on output and state.json', async () => {
    let capturedSessionId: string | undefined
    const agent: AgentRunner<{ answer: string }> = {
      __kind: 'agent',
      mode: 'read-only',
      prompt: 'compute answer',
      executeTurn: async (input) => {
        capturedSessionId = input.sessionId
        return {
          output: { answer: '42' },
          sessionId: input.sessionId,
        }
      },
    }

    const result = await runHarness({
      name: 'auto-session-pipeline',
      steps: [
        { id: 'agent-step-1', run: agent },
      ],
    }, { workspaceDir: tempDir })

    expect(result.status).toBe('passed')
    const step1Output = result.steps['agent-step-1']?.output as { answer: string, sessionId: string }
    expect(step1Output.answer).toBe('42')
    expect(step1Output.sessionId).toMatch(/^session-[0-9a-f-]+$/)
    expect(step1Output.sessionId).toBe(capturedSessionId)

    const runDir = resolveRunDir(tempDir, result.runId)
    const savedState = readRunState(runDir)
    const persistedStepOutput = savedState.steps['agent-step-1']?.output as { answer: string, sessionId: string }
    expect(persistedStepOutput.sessionId).toBe(step1Output.sessionId)

    const events = readLedgerEvents(runDir)
    const passedEvent = events.find(e => e.eventType === 'step.passed' && e.stepId === 'agent-step-1')
    expect((passedEvent?.payload.output as { sessionId: string })?.sessionId).toBe(step1Output.sessionId)
  })
})

describe('runHarness empty and whitespace sessionId fallback', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-agent-sess-ws-'))
  })
  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('falls back to fresh session-<uuid> when sessionId is empty or whitespace', async () => {
    let capturedSessionId: string | undefined
    const agent: AgentRunner<{ ok: boolean }> = {
      __kind: 'agent',
      mode: 'read-only',
      prompt: 'ping',
      sessionId: '   ',
      executeTurn: async (input) => {
        capturedSessionId = input.sessionId
        return {
          output: { ok: true },
          sessionId: input.sessionId,
        }
      },
    }

    const result = await runHarness({
      name: 'whitespace-session-pipeline',
      steps: [
        { id: 'step-ws', run: agent },
      ],
    }, { workspaceDir: tempDir })

    expect(result.status).toBe('passed')
    expect(capturedSessionId).toMatch(/^session-[0-9a-f-]+$/)
    const output = result.steps['step-ws']?.output as { ok: boolean, sessionId: string }
    expect(output.sessionId).toBe(capturedSessionId)
  })
})

describe('runHarness cross-step session resumption (AC 3.2.2)', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-agent-sess-resume-'))
  })
  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('resumes prior session thread in downstream agent step', async () => {
    let step1InputSessionId: string | undefined
    let step2InputSessionId: string | undefined

    const step1Agent: AgentRunner<{ query: string }> = {
      __kind: 'agent',
      mode: 'read-only',
      prompt: 'Initial query',
      executeTurn: async (input) => {
        step1InputSessionId = input.sessionId
        return {
          output: { query: 'Initial query' },
          sessionId: input.sessionId,
        }
      },
    }

    const step2Agent: AgentRunner<{ followUp: string }> = {
      __kind: 'agent',
      mode: 'read-only',
      prompt: 'Follow up',
      sessionId: (ctx: StepContext) => (ctx.steps['step-1']?.output as { sessionId: string }).sessionId,
      executeTurn: async (input) => {
        step2InputSessionId = input.sessionId
        return {
          output: { followUp: 'Done follow up' },
          sessionId: input.sessionId,
        }
      },
    }

    const result = await runHarness({
      name: 'session-resumption-pipeline',
      steps: [
        { id: 'step-1', run: step1Agent },
        { id: 'step-2', run: step2Agent },
      ],
    }, { workspaceDir: tempDir })

    expect(result.status).toBe('passed')
    expect(step1InputSessionId).toBeDefined()
    expect(step2InputSessionId).toBe(step1InputSessionId)

    const step2Output = result.steps['step-2']?.output as { followUp: string, sessionId: string }
    expect(step2Output.sessionId).toBe(step1InputSessionId)
  })
})

describe('runHarness primitive and array output wrapping', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-agent-sess-wrap-'))
  })
  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('wraps primitive output in { value, sessionId } and persists it', async () => {
    const stringAgent: AgentRunner<string> = {
      __kind: 'agent',
      mode: 'read-only',
      prompt: 'return string',
      executeTurn: async input => ({ output: 'raw-text', sessionId: input.sessionId }),
    }

    const arrayAgent: AgentRunner<number[]> = {
      __kind: 'agent',
      mode: 'read-only',
      prompt: 'return numbers',
      executeTurn: async input => ({
        output: [1, 2, 3],
        sessionId: input.sessionId,
      }),
    }

    const result = await runHarness({
      name: 'wrap-pipeline',
      steps: [
        { id: 'step-str', run: stringAgent },
        { id: 'step-arr', run: arrayAgent },
      ],
    }, { workspaceDir: tempDir })

    expect(result.status).toBe('passed')

    const strOutput = result.steps['step-str']?.output as { value: string, sessionId: string }
    expect(strOutput.value).toBe('raw-text')
    expect(strOutput.sessionId).toMatch(/^session-[0-9a-f-]+$/)

    const arrOutput = result.steps['step-arr']?.output as { value: number[], sessionId: string }
    expect(arrOutput.value).toEqual([1, 2, 3])
    expect(arrOutput.sessionId).toMatch(/^session-[0-9a-f-]+$/)
  })
})
