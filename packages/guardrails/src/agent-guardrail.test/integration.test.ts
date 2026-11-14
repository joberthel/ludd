import type { AgentRunner, AgentTurnInput } from '@ludd/core'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  GuardrailMaxRetriesExceededError,
  readLedgerEvents,
  readStreamEvents,
  resolveRunDir,
  runHarness,
} from '@ludd/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { agentGuardrail } from '../agent-guardrail.js'

function createMainAgent(prompts: string[]): AgentRunner<{ code: string }> {
  return {
    __kind: 'agent',
    mode: 'workspace-write',
    prompt: 'Write code slice',
    executeTurn: async (input: AgentTurnInput) => {
      prompts.push(input.prompt)
      const code = input.attempt === 1
        ? 'buggy code'
        : 'fixed clean code'
      return {
        output: { code },
        sessionId: input.sessionId,
      }
    },
  }
}

function createReviewAgent(tracking: { modes: string[], sessionIds: string[] }): AgentRunner<any> {
  let count = 0
  return {
    __kind: 'agent',
    mode: 'read-only',
    prompt: 'Review git diff',
    executeTurn: async (input: AgentTurnInput) => {
      tracking.modes.push(input.mode)
      tracking.sessionIds.push(input.sessionId)
      count++
      if (count === 1) {
        return {
          output: {
            status: 'fail',
            body: {
              findings: ['Security vulnerability: SQL injection detected'],
            },
          },
          sessionId: input.sessionId,
        }
      }
      return {
        output: {
          status: 'pass',
          body: { findings: [] },
        },
        sessionId: input.sessionId,
      }
    },
  }
}

async function verifyOffloadedLogs(runDir: string): Promise<void> {
  const logFilePath = path.join(runDir, 'logs', 'implement-slice-1-afterStep-0.log')
  const logContent = await readFile(logFilePath, 'utf-8')
  expect(JSON.parse(logContent)).toEqual({
    findings: ['Security vulnerability: SQL injection detected'],
  })
}

function verifyTelemetry(runDir: string, sessionIds: string[]): void {
  const ledgerEvents = readLedgerEvents(runDir)
  const linked = ledgerEvents.filter(e => e.eventType === 'agent.stream.linked')
  const reviewLinked = linked.filter(e =>
    (e.payload as { sessionId: string }).sessionId.startsWith('guardrail-session-'),
  )
  expect(reviewLinked.length).toBe(2)
  expect((reviewLinked[0].payload as { sessionId: string }).sessionId).toBe(sessionIds[0])
  expect((reviewLinked[1].payload as { sessionId: string }).sessionId).toBe(sessionIds[1])

  const stream1 = readStreamEvents(runDir, sessionIds[0])
  expect(stream1.map(e => e.eventType)).toEqual(['turn.started', 'turn.completed'])
  expect(stream1[0].payload).toEqual({
    prompt: 'Prüfe den aktuellen Git-Diff dieses Slices auf Sicherheitslücken.',
    mode: 'read-only',
  })
  const stream2 = readStreamEvents(runDir, sessionIds[1])
  expect(stream2.map(e => e.eventType)).toEqual(['turn.started', 'turn.completed'])
}

describe('agentGuardrail integration: self-healing workflow (AC 5.4.1 - 5.4.3)', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-agent-guardrail-integration-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('triggers self-healing retry on fail, offloads body, and completes when fixed', async () => {
    const prompts: string[] = []
    const tracking = { modes: [] as string[], sessionIds: [] as string[] }
    const rail = agentGuardrail({
      mode: 'read-only',
      maxRetries: 2,
      bodySchema: z.object({
        findings: z.array(z.string()),
      }),
      prompt: 'Prüfe den aktuellen Git-Diff dieses Slices auf Sicherheitslücken.',
      agent: createReviewAgent(tracking),
    })

    const result = await runHarness({
      name: 'agent-guardrail-self-healing-flow',
      steps: [
        {
          id: 'implement-slice',
          run: createMainAgent(prompts),
          outputSchema: z.object({
            code: z.string(),
          }),
          afterStep: [rail],
        },
      ],
    }, { workspaceDir: tempDir })

    expect(result.status).toBe('passed')
    expect(tracking.modes).toEqual(['read-only', 'read-only'])
    expect(tracking.sessionIds[0]).toMatch(/^guardrail-session-[0-9a-f-]{36}$/)
    expect(tracking.sessionIds[0]).not.toBe(tracking.sessionIds[1])

    expect(prompts.length).toBe(2)
    expect(prompts[1]).toContain('Detailed failure log has been offloaded to MCP logKey "implement-slice-1-afterStep-0"')

    const runDir = resolveRunDir(tempDir, result.runId)
    await verifyOffloadedLogs(runDir)
    verifyTelemetry(runDir, tracking.sessionIds)
  })
})

describe('agentGuardrail integration: retry exhaustion', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-agent-guardrail-retries-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('fails with GuardrailMaxRetriesExceededError when retries exceeded', async () => {
    const mainAgent: AgentRunner<{ ok: boolean }> = {
      __kind: 'agent',
      mode: 'workspace-write',
      prompt: 'Task',
      executeTurn: async input => ({
        output: { ok: true },
        sessionId: input.sessionId,
      }),
    }

    const reviewAgent: AgentRunner<any> = {
      __kind: 'agent',
      mode: 'read-only',
      prompt: 'Review',
      executeTurn: async input => ({
        output: {
          status: 'fail',
          body: { error: 'Always fails' },
        },
        sessionId: input.sessionId,
      }),
    }

    const rail = agentGuardrail({ maxRetries: 1, prompt: 'Check', agent: reviewAgent })
    const result = await runHarness({
      name: 'max-retries-test',
      steps: [
        {
          id: 'failing-step',
          run: mainAgent,
          afterStep: [rail],
        },
      ],
    }, { workspaceDir: tempDir })

    expect(result.status).toBe('failed')
    expect(result.error).toBeInstanceOf(GuardrailMaxRetriesExceededError)
  })
})
