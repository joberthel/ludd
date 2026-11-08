import type { StepContext } from '@ludd/core'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { appendStreamEvent, readStreamEvents, resolveRunDir, runHarness } from '@ludd/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mockAgent } from '../mock-agent.js'

function createTelemetryTestAgent() {
  return mockAgent<{ result: string }>({
    prompt: 'Refactor module',
    events: [
      {
        eventType: 'thought',
        payload: { reasoning: 'inspect imports' },
      },
      {
        eventType: 'tool_call',
        payload: { tool: 'ast_grep', query: 'imports' },
      },
      {
        eventType: 'message_chunk',
        payload: { chunk: 'Refactoring done' },
      },
    ],
    responses: [
      { result: 'success' },
    ],
  })
}

function createResumeAgent(phase: number, sessionId?: (ctx: StepContext) => string) {
  return mockAgent<string>({
    prompt: `Phase ${phase}`,
    sessionId,
    events: [
      {
        eventType: 'thought',
        payload: { phase },
      },
    ],
    responses: [`step-${phase}-finished`],
  })
}

describe('mockAgent telemetry streaming in harness (AC 3.3.1)', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-mock-agent-telemetry-'))
  })
  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('emits turn.started, configured events, and turn.completed in order', async () => {
    const agent = createTelemetryTestAgent()
    const runResult = await runHarness({
      name: 'telemetry-stream-pipeline',
      steps: [
        { id: 'agent-telemetry-step', run: agent },
      ],
    }, { workspaceDir: tempDir })

    expect(runResult.status).toBe('passed')
    const stepOutput = runResult.steps['agent-telemetry-step']?.output as { sessionId: string }
    const sessionId = stepOutput.sessionId

    const runDir = resolveRunDir(tempDir, runResult.runId)
    const streamEvents = readStreamEvents(runDir, sessionId)

    expect(streamEvents).toHaveLength(5)
    expect(streamEvents.map(e => e.eventType)).toEqual([
      'turn.started',
      'thought',
      'tool_call',
      'message_chunk',
      'turn.completed',
    ])
    expect(streamEvents[1].payload).toEqual({ reasoning: 'inspect imports' })
    expect(streamEvents[2].payload).toEqual({ tool: 'ast_grep', query: 'imports' })
    expect(streamEvents[3].payload).toEqual({ chunk: 'Refactoring done' })
    expect(streamEvents[4].payload).toEqual({
      output: { result: 'success' },
    })
  })
})

describe('mockAgent scripted turn events and direct stream appending', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-mock-agent-direct-'))
  })
  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('supports per-turn scripted events and functional appendStreamEvent calls', async () => {
    const agent = mockAgent<string>({
      prompt: 'Interactive turn',
      responses: [
        {
          output: 'turn-1-done',
          events: [
            {
              eventType: 'thought',
              payload: { note: 'turn 1 thought' },
            },
          ],
        },
        async (input) => {
          appendStreamEvent(input.runDir, input.sessionId, {
            schemaVersion: 1,
            timestamp: new Date().toISOString(),
            runId: input.ctx.runId,
            stepId: input.stepId,
            sessionId: input.sessionId,
            attempt: input.attempt,
            eventType: 'tool_call',
            payload: { tool: 'functional_tool' },
          })
          return 'turn-2-done'
        },
      ],
    })

    const runResult = await runHarness({
      name: 'multi-turn-telemetry-pipeline',
      steps: [
        { id: 'step-t1', run: agent },
        { id: 'step-t2', run: agent },
      ],
    }, { workspaceDir: tempDir })

    expect(runResult.status).toBe('passed')
  })
})

describe('mockAgent telemetry with session resumption across steps (AC 3.3.3)', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-mock-agent-sess-stream-'))
  })
  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('chronologically appends events across multiple steps into the same session stream', async () => {
    const agent1 = createResumeAgent(1)
    const agent2 = createResumeAgent(
      2,
      (ctx: StepContext) => (ctx.steps['step-p1']?.output as { sessionId: string }).sessionId,
    )

    const result = await runHarness({
      name: 'cross-step-stream-pipeline',
      steps: [
        { id: 'step-p1', run: agent1 },
        { id: 'step-p2', run: agent2 },
      ],
    }, { workspaceDir: tempDir })

    expect(result.status).toBe('passed')
    const sessionId = (result.steps['step-p1']?.output as { sessionId: string }).sessionId
    const runDir = resolveRunDir(tempDir, result.runId)
    const events = readStreamEvents(runDir, sessionId)

    expect(events.map(e => `${e.stepId}:${e.eventType}`)).toEqual([
      'step-p1:turn.started',
      'step-p1:thought',
      'step-p1:turn.completed',
      'step-p2:turn.started',
      'step-p2:thought',
      'step-p2:turn.completed',
    ])
  })
})
