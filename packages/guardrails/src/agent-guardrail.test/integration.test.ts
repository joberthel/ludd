import type { AgentRunner, AgentTurnInput } from '@luddjs/core'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { mockAgent } from '@luddjs/agents'
import {
  GuardrailMaxRetriesExceededError,
  resolveRunDir,
  runHarness,
} from '@luddjs/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { agentGuardrail } from '../agent-guardrail.js'

function createMainAgent(prompts: string[]): AgentRunner<{ code: string }> {
  const handleTurn = (input: AgentTurnInput) => {
    prompts.push(input.prompt)
    return {
      code: input.attempt === 1
        ? 'buggy code'
        : 'fixed clean code',
    }
  }
  return mockAgent({
    mode: 'workspace-write',
    prompt: 'Write code slice',
    responses: [handleTurn, handleTurn],
  })
}

function createReviewAgent(tracking: { modes: string[], sessionIds: string[] }): AgentRunner<any> {
  const recordTurn = (input: AgentTurnInput) => {
    tracking.modes.push(input.mode)
    tracking.sessionIds.push(input.sessionId)
  }
  return mockAgent({
    mode: 'read-only',
    prompt: 'Review git diff',
    responses: [
      (input) => {
        recordTurn(input)
        return {
          status: 'fail',
          body: {
            findings: ['Security vulnerability: SQL injection detected'],
          },
        }
      },
      (input) => {
        recordTurn(input)
        return {
          status: 'pass',
          body: { findings: [] },
        }
      },
    ],
  })
}

async function verifyOffloadedLogs(runDir: string): Promise<void> {
  const logFilePath = path.join(runDir, 'logs', 'implement-slice-1-afterStep-0.log')
  const logContent = await readFile(logFilePath, 'utf-8')
  expect(JSON.parse(logContent)).toEqual({
    findings: ['Security vulnerability: SQL injection detected'],
  })
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
    const mainAgent = mockAgent<{ ok: boolean }>({
      mode: 'workspace-write',
      prompt: 'Task',
      responses: [
        { ok: true },
        { ok: true },
      ],
    })

    const failVerdict = {
      status: 'fail',
      body: { error: 'Always fails' },
    }
    const reviewAgent = mockAgent({
      mode: 'read-only',
      prompt: 'Review',
      responses: [failVerdict, failVerdict],
    })

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
