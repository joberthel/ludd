import type { AgentRunner } from '../../types/agent.js'
import type { StepContext } from '../../types/context.js'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readLedgerEvents } from '../../persistence/ledger-writer.js'
import { resolveRunDir } from '../../persistence/state-store.js'
import { readStreamEvents, resolveStreamPath } from '../../persistence/stream-writer.js'
import { runHarness } from '../run-harness.js'

function createSimpleStreamAgent(answer: string): AgentRunner<{ answer: string }> {
  return {
    __kind: 'agent',
    mode: 'read-only',
    prompt: 'compute something',
    executeTurn: async input => ({
      output: { answer },
      sessionId: input.sessionId,
    }),
  }
}

describe('runHarness agent telemetry stream writing (AC 3.3.1)', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-stream-ac1-'))
  })
  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('creates streams/<sessionId>.jsonl with turn.started and turn.completed', async () => {
    const agent = createSimpleStreamAgent('streamed-answer')
    const result = await runHarness({
      name: 'agent-stream-pipeline',
      steps: [
        { id: 'agent-step-1', run: agent },
      ],
    }, { workspaceDir: tempDir })

    expect(result.status).toBe('passed')
    const stepOutput = result.steps['agent-step-1']?.output as { answer: string, sessionId: string }
    const sessionId = stepOutput.sessionId

    const runDir = resolveRunDir(tempDir, result.runId)
    const streamEvents = readStreamEvents(runDir, sessionId)

    expect(streamEvents).toHaveLength(2)
    expect(streamEvents[0]).toMatchObject({
      schemaVersion: 1,
      runId: result.runId,
      stepId: 'agent-step-1',
      sessionId,
      attempt: 1,
      eventType: 'turn.started',
      payload: { prompt: 'compute something', mode: 'read-only' },
    })
    expect(streamEvents[1]).toMatchObject({
      schemaVersion: 1,
      runId: result.runId,
      stepId: 'agent-step-1',
      sessionId,
      attempt: 1,
      eventType: 'turn.completed',
      payload: {
        output: { answer: 'streamed-answer' },
      },
    })
  })
})

describe('runHarness agent.stream.linked ledger event (AC 3.3.2)', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-stream-ac2-'))
  })
  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('emits agent.stream.linked in ledger.jsonl without token chunks', async () => {
    const agent: AgentRunner<{ status: string }> = {
      __kind: 'agent',
      mode: 'workspace-write',
      prompt: 'modify files',
      executeTurn: async input => ({
        output: { status: 'completed' },
        sessionId: input.sessionId,
      }),
    }

    const result = await runHarness({
      name: 'agent-ledger-stream-linked-pipeline',
      steps: [
        { id: 'agent-step-write', run: agent },
      ],
    }, { workspaceDir: tempDir })

    expect(result.status).toBe('passed')
    const stepOutput = result.steps['agent-step-write']?.output as { status: string, sessionId: string }
    const sessionId = stepOutput.sessionId

    const runDir = resolveRunDir(tempDir, result.runId)
    const ledgerEvents = readLedgerEvents(runDir)

    const linkedEvent = ledgerEvents.find(
      e => e.eventType === 'agent.stream.linked' && e.stepId === 'agent-step-write',
    )
    expect(linkedEvent).toBeDefined()
    expect(linkedEvent?.schemaVersion).toBe(1)
    expect(linkedEvent?.payload).toEqual({
      sessionId,
      streamPath: `streams/${sessionId}.jsonl`,
      attempt: 1,
    })

    const nonLedgerTypes = [
      'turn.started',
      'thought',
      'tool_call',
      'message_chunk',
      'turn.completed',
    ]
    const hasTelemetryInLedger = ledgerEvents.some(e => nonLedgerTypes.includes(e.eventType))
    expect(hasTelemetryInLedger).toBe(false)
  })
})

describe('runHarness multi-step stream appending with session resumption (AC 3.3.3)', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-agent-stream-resume-'))
  })
  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('appends step 2 events to the exact same streams/<sessionId>.jsonl file', async () => {
    const step1Agent: AgentRunner<{ step1Done: boolean }> = {
      __kind: 'agent',
      mode: 'read-only',
      prompt: 'step 1 prompt',
      executeTurn: async input => ({
        output: { step1Done: true },
        sessionId: input.sessionId,
      }),
    }

    const step2Agent: AgentRunner<{ step2Done: boolean }> = {
      __kind: 'agent',
      mode: 'workspace-write',
      prompt: 'step 2 prompt',
      sessionId: (ctx: StepContext) => (ctx.steps['step-1']?.output as { sessionId: string }).sessionId,
      executeTurn: async input => ({
        output: { step2Done: true },
        sessionId: input.sessionId,
      }),
    }

    const result = await runHarness({
      name: 'resume-stream-pipeline',
      steps: [
        { id: 'step-1', run: step1Agent },
        { id: 'step-2', run: step2Agent },
      ],
    }, { workspaceDir: tempDir })

    expect(result.status).toBe('passed')
    const step1Output = result.steps['step-1']?.output as { sessionId: string }
    const sessionId = step1Output.sessionId

    const runDir = resolveRunDir(tempDir, result.runId)
    expect(resolveStreamPath(runDir, sessionId)).toContain(`streams/${sessionId}.jsonl`)

    const streamEvents = readStreamEvents(runDir, sessionId)
    expect(streamEvents).toHaveLength(4)
    expect(streamEvents.map(e => `${e.stepId}:${e.eventType}`)).toEqual([
      'step-1:turn.started',
      'step-1:turn.completed',
      'step-2:turn.started',
      'step-2:turn.completed',
    ])
  })
})
