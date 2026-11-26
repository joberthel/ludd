import type { AgentRunner, AgentTurnInput } from '../../types/agent.js'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { readLedgerEvents } from '../../persistence/ledger-writer.js'
import { resolveRunDir } from '../../persistence/state-store.js'
import { runHarness } from '../run-harness.js'

function createSelfHealingAgent(turns: AgentTurnInput[]): AgentRunner<{ commitMessage: string }> {
  return {
    __kind: 'agent',
    mode: 'read-only',
    prompt: 'Generate commit message',
    executeTurn: async (input) => {
      turns.push(input)
      if (input.attempt === 1) {
        return {
          output: { commitMessage: 'abc' },
          sessionId: input.sessionId,
        }
      }
      return {
        output: { commitMessage: 'feat: add agent retry' },
        sessionId: input.sessionId,
      }
    },
  }
}

describe('runHarness agent outputSchema self-healing (AC 3.4.1, AC 3.4.2)', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-agent-retry-'))
  })
  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('self-heals on Turn 2, emits step.retry, and includes error details in prompt', async () => {
    const turns: AgentTurnInput[] = []
    const schema = z.object({
      commitMessage: z.string().min(5),
    })
    const agent = createSelfHealingAgent(turns)

    const result = await runHarness({
      name: 'self-heal-harness',
      steps: [
        { id: 'commit-step', run: agent, outputSchema: schema },
      ],
    }, { workspaceDir: tempDir })

    expect(result.status).toBe('passed')
    expect(turns).toHaveLength(2)
    expect(turns[0].attempt).toBe(1)
    expect(turns[1].attempt).toBe(2)
    expect(turns[0].sessionId).toBe(turns[1].sessionId)
    expect(turns[1].prompt).toContain('commitMessage')
    expect(turns[1].prompt).toContain('Generate commit message')

    const runDir = resolveRunDir(tempDir, result.runId)
    const ledgerEvents = readLedgerEvents(runDir)
    const retryEvent = ledgerEvents.find(e => e.eventType === 'step.retry')

    expect(retryEvent?.payload).toMatchObject({
      attempt: 2,
      sessionId: turns[0].sessionId,
      reason: 'output_schema_validation_failed',
    })
  })
})

describe('runHarness agent unhandled crash without retry', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-agent-unhandled-'))
  })
  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('fails immediately without retry when agent throws unexpected runtime error', async () => {
    let turnCount = 0
    const agent: AgentRunner = {
      __kind: 'agent',
      mode: 'read-only',
      prompt: 'boom',
      executeTurn: async () => {
        turnCount += 1
        throw new Error('unhandled agent crash')
      },
    }

    const result = await runHarness({
      name: 'crash-harness',
      steps: [
        { id: 'crash-step', run: agent },
      ],
    }, { workspaceDir: tempDir })

    expect(result.status).toBe('failed')
    expect(turnCount).toBe(1)
    expect((result.error as Error).message).toBe('unhandled agent crash')
  })
})

describe('runHarness unexpected output validation parser errors', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-agent-exploding-'))
  })
  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('rethrows unexpected non-validation error thrown during output validation', async () => {
    const explodingSchema = {
      safeParseAsync: async () => {
        throw new Error('schema parser exploded')
      },
    }
    const agent: AgentRunner = {
      __kind: 'agent',
      mode: 'read-only',
      prompt: 'ping',
      executeTurn: async input => ({ output: 'ok', sessionId: input.sessionId }),
    }

    const result = await runHarness({
      name: 'exploding-schema-harness',
      steps: [
        { id: 'exploding-step', run: agent, outputSchema: explodingSchema as any },
      ],
    }, { workspaceDir: tempDir })

    expect(result.status).toBe('failed')
    expect((result.error as Error).message).toBe('schema parser exploded')
  })
})
