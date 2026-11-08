import type { AgentRunner, AgentTurnInput } from '../../types/agent.js'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { MaxTotalTurnsExceededError } from '../../errors/max-total-turns-exceeded-error.js'
import { readLedgerEvents } from '../../persistence/ledger-writer.js'
import { resolveRunDir } from '../../persistence/state-store.js'
import { readStreamEvents } from '../../persistence/stream-writer.js'
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

    const streamEvents = readStreamEvents(runDir, turns[0].sessionId)
    expect(streamEvents).toHaveLength(4)
    expect(streamEvents.map(e => `${e.attempt}:${e.eventType}`)).toEqual([
      '1:turn.started',
      '1:turn.completed',
      '2:turn.started',
      '2:turn.completed',
    ])
  })
})

describe('runHarness maxTotalTurns circuit breaker (AC 3.4.3)', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-agent-max-turns-'))
  })
  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('halts after maxTotalTurns without invoking extra turns and marks run failed', async () => {
    let callCount = 0
    const schema = z.object({
      valid: z.literal(true),
    })
    const agent: AgentRunner<{ valid: boolean }> = {
      __kind: 'agent',
      mode: 'read-only',
      prompt: 'always invalid',
      executeTurn: async (input) => {
        callCount += 1
        return {
          output: { valid: false },
          sessionId: input.sessionId,
        }
      },
    }

    const result = await runHarness({
      name: 'circuit-breaker-harness',
      steps: [
        {
          id: 'failing-agent-step',
          run: agent,
          outputSchema: schema,
          maxTotalTurns: 3,
        },
      ],
    }, { workspaceDir: tempDir })

    expect(result.status).toBe('failed')
    expect(callCount).toBe(3)
    expect(result.failedStepId).toBe('failing-agent-step')
    expect(result.error).toBeInstanceOf(MaxTotalTurnsExceededError)

    const maxTurnsError = result.error as MaxTotalTurnsExceededError
    expect(maxTurnsError.stepId).toBe('failing-agent-step')
    expect(maxTurnsError.maxTotalTurns).toBe(3)

    const runDir = resolveRunDir(tempDir, result.runId)
    const ledgerEvents = readLedgerEvents(runDir)
    expect(ledgerEvents.filter(e => e.eventType === 'step.retry')).toHaveLength(2)
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
        { id: 'crash-step', run: agent, maxTotalTurns: 5 },
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
