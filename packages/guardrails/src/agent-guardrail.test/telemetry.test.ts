import type {
  AgentTurnInput,
  Guardrail,
  GuardrailExecutionInput,
  ProvisionedEnvironment,
  StepContext,
} from '@ludd/core'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { mockAgent } from '@ludd/agents'
import { readLedgerEvents, readStreamEvents } from '@ludd/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { agentGuardrail } from '../agent-guardrail.js'

const mockEnv: ProvisionedEnvironment = {
  __kind: 'environment',
  id: 'mock-env',
  type: 'host',
  workingDir: '/workspace',
  exec: async () => ({
    exitCode: 0,
    stdout: '',
    stderr: '',
    timedOut: false,
  }),
  ping: async () => true,
  teardown: async () => {},
}

function createTelemetryContext(): StepContext {
  return {
    runId: 'run-telemetry',
    environments: { host: mockEnv },
    steps: {},
    step: { id: 'step-review', output: undefined, attempt: 1 },
    matrix: {
      index: 2,
      total: 5,
      item: { id: 'slice-2' },
    },
    artifacts: {} as any,
  }
}

function createAgentWithEvents() {
  return mockAgent({
    prompt: 'Review',
    events: [
      {
        eventType: 'thought',
        payload: { text: 'Checking architecture' },
      },
      {
        eventType: 'tool_call',
        payload: { tool: 'diff_view', args: {} },
      },
    ],
    responses: [
      {
        status: 'pass',
        body: { ok: true },
      },
    ],
  })
}

async function runTelemetryRail(rail: Guardrail, dir: string) {
  const input: GuardrailExecutionInput = {
    ctx: createTelemetryContext(),
    stepId: 'step-review',
    phase: 'afterStep',
    guardrailIndex: 0,
    attempt: 1,
    runDir: dir,
    environment: mockEnv,
    mcpServerUrl: 'http://127.0.0.1:4000',
    mcpAuthToken: 'token',
  }
  return rail.execute(input)
}

describe('agentGuardrail telemetry: ledger stream linking', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-guardrail-test-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('emits agent.stream.linked to ledger.jsonl', async () => {
    const rail = agentGuardrail({
      agent: createAgentWithEvents(),
      prompt: 'Review',
    })
    const verdict = await runTelemetryRail(rail, tmpDir)
    expect(verdict.status).toBe('pass')

    const ledgerEvents = readLedgerEvents(tmpDir)
    const linkedEvent = ledgerEvents.find(e => e.eventType === 'agent.stream.linked')
    expect(linkedEvent).toBeDefined()
    expect(linkedEvent?.runId).toBe('run-telemetry')
    expect(linkedEvent?.matrixIndex).toBe(2)

    const payload = linkedEvent?.payload as { sessionId: string, streamPath: string, attempt: number }
    expect(payload.sessionId).toMatch(/^guardrail-session-[0-9a-f-]{36}$/)
    expect(payload.streamPath).toBe(`streams/${payload.sessionId}.jsonl`)
  })

  it('writes turn.started, mid-turn, and turn.completed events to stream file', async () => {
    const rail = agentGuardrail({
      agent: createAgentWithEvents(),
      prompt: 'Review',
      mode: 'read-only',
    })
    await runTelemetryRail(rail, tmpDir)

    const linked = readLedgerEvents(tmpDir).find(e => e.eventType === 'agent.stream.linked')
    const sessionId = (linked?.payload as { sessionId: string }).sessionId

    const streamEvents = readStreamEvents(tmpDir, sessionId)
    expect(streamEvents.map(e => e.eventType)).toEqual([
      'turn.started',
      'thought',
      'tool_call',
      'turn.completed',
    ])
    expect(streamEvents[0].payload).toEqual({ prompt: 'Review', mode: 'read-only' })
    expect(streamEvents[3].payload).toEqual({
      output: {
        status: 'pass',
        body: { ok: true },
      },
    })
  })
})

describe('agentGuardrail telemetry: empty runDir handling', () => {
  it('handles empty runDir gracefully without emitting file telemetry', async () => {
    let callCount = 0
    const agent = {
      __kind: 'agent' as const,
      mode: 'read-only' as const,
      prompt: 'Review',
      executeTurn: async (turnInput: AgentTurnInput) => {
        callCount++
        return {
          output: { status: 'pass' },
          sessionId: turnInput.sessionId,
        }
      },
    }

    const rail = agentGuardrail({ agent, prompt: 'Review' })
    const ctx: StepContext = {
      runId: 'run-1',
      environments: {},
      steps: {},
      step: { id: 'step-1', output: undefined, attempt: 1 },
      matrix: undefined,
      artifacts: {} as any,
    }

    const input: GuardrailExecutionInput = {
      ctx,
      stepId: 'step-1',
      phase: 'afterStep',
      guardrailIndex: 0,
      attempt: 1,
      runDir: '',
      environment: mockEnv,
      mcpServerUrl: '',
      mcpAuthToken: '',
    }

    const verdict = await rail.execute(input)
    expect(verdict.status).toBe('pass')
    expect(callCount).toBe(1)
  })
})
