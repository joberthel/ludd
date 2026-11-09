import type { AgentRunner, AgentTurnInput } from '../../types/agent.js'
import type { Guardrail } from '../../types/guardrail.js'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GuardrailMaxRetriesExceededError } from '../../errors/guardrail-max-retries-exceeded-error.js'
import { readLedgerEvents } from '../../persistence/ledger-writer.js'
import { resolveRunDir } from '../../persistence/state-store.js'
import { runHarness } from '../run-harness.js'

let tempDir: string

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-ping-pong-'))
})
afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

function makeTestAgent(outputs: readonly { code: string }[]): AgentRunner<{ code: string }> {
  let callCount = 0
  return {
    __kind: 'agent',
    mode: 'workspace-write',
    prompt: 'Write code',
    executeTurn: async (input: AgentTurnInput) => {
      const output = outputs[callCount] ?? outputs[outputs.length - 1]
      callCount += 1
      return { output, sessionId: input.sessionId }
    },
  }
}

function createTestRail(options: {
  maxRetries?: number
  failAttempts?: readonly number[]
  onExecute?: (attempt: number) => void
}): Guardrail {
  return {
    __kind: 'guardrail',
    type: 'fn',
    maxRetries: options.maxRetries,
    execute: async (input) => {
      options.onExecute?.(input.attempt)
      return options.failAttempts?.includes(input.attempt)
        ? { status: 'fail', body: `fail-${input.attempt}` }
        : { status: 'pass' }
    },
  }
}

describe('afterStep guardrails full chain restart (AC 5.1.1)', () => {
  it('restarts afterStep chain at index 0 after agent self-healing turn', async () => {
    const executions: { index: number, attempt: number }[] = []
    const rail0 = createTestRail({
      maxRetries: 3,
      onExecute: attempt => executions.push({ index: 0, attempt }),
    })
    const rail1 = createTestRail({
      maxRetries: 3,
      failAttempts: [1],
      onExecute: attempt => executions.push({ index: 1, attempt }),
    })

    const agent = makeTestAgent([
      { code: 'broken' },
      { code: 'fixed' },
    ])
    const result = await runHarness({
      name: 'restart-chain-test',
      steps: [
        {
          id: 'implement',
          run: agent,
          afterStep: [rail0, rail1],
        },
      ],
    }, { workspaceDir: tempDir })

    expect(result.status).toBe('passed')
    expect(executions).toEqual([
      { index: 0, attempt: 1 },
      { index: 1, attempt: 1 },
      { index: 0, attempt: 2 },
      { index: 1, attempt: 2 },
    ])

    const runDir = resolveRunDir(tempDir, result.runId)
    const ledger = readLedgerEvents(runDir)
    const retryEvent = ledger.find(e => e.eventType === 'step.retry')
    expect(retryEvent?.payload.reason).toBe('guardrail_failed')
  })
})

describe('afterStep guardrails ping-pong protection (AC 5.1.2)', () => {
  it('cumulatively tracks maxRetries per guardrail to prevent ping-pong oscillation', async () => {
    const rail0 = createTestRail({
      maxRetries: 1,
      failAttempts: [2],
    })
    const rail1 = createTestRail({
      maxRetries: 1,
      failAttempts: [1, 3],
    })
    const agent = makeTestAgent([
      { code: 't1' },
      { code: 't2' },
      { code: 't3' },
    ])
    const result = await runHarness({
      name: 'ping-pong-prevention-test',
      steps: [
        {
          id: 'implement',
          run: agent,
          afterStep: [rail0, rail1],
        },
      ],
    }, { workspaceDir: tempDir })

    expect(result.status).toBe('failed')
    expect(result.error).toBeInstanceOf(GuardrailMaxRetriesExceededError)
    const error = result.error as GuardrailMaxRetriesExceededError
    expect(error.guardrailIndex).toBe(1)
    expect(error.maxRetries).toBe(1)
  })
})
