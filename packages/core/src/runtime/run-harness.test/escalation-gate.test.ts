import type { AgentRunner } from '../../types/agent.js'
import type { ControlClient } from '../../types/ipc.js'
import fs from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { execGuardrail, fnGuardrail } from '@ludd/guardrails'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createControlClient } from '../../ipc/control-client.js'
import { getControlSocketPath } from '../../ipc/socket-path.js'
import { readLedgerEvents } from '../../persistence/ledger-writer.js'
import { readRunState } from '../../persistence/state-store.js'
import { runHarness } from '../run-harness.js'

async function waitForEscalationGate(runDir: string): Promise<ControlClient> {
  let client: ControlClient | undefined
  for (let i = 0; i < 50; i++) {
    try {
      if (!client) {
        client = await createControlClient(runDir)
      }
      const state = await client.status()
      if (state.status === 'waiting_for_gate' && state.activeGate?.gateType === 'max_retries_exceeded') {
        return client
      }
    }
    catch {
      // Socket may not be ready yet
    }
    await new Promise(r => setTimeout(r, 50))
  }
  throw new Error('Timeout waiting for escalation gate')
}

async function resolveWaitingGate(
  runDir: string,
  stepId: string,
  action: 'pass' | 'skip' | 'abort',
): Promise<void> {
  const client = await waitForEscalationGate(runDir)
  await client.resolveGate({ stepId, guardrailIndex: 0, action })
  await client.close()
}

function createCounterAgent(attempts: number[]): AgentRunner {
  return {
    __kind: 'agent',
    mode: 'workspace-write',
    prompt: 'Implement feature',
    executeTurn: async (input) => {
      attempts.push(input.attempt)
      return {
        output: { turn: input.attempt },
        sessionId: input.sessionId,
      }
    },
  }
}

let tempDir: string

beforeEach(async () => {
  const baseDir = process.platform === 'win32'
    ? os.tmpdir()
    : '/tmp'
  tempDir = await mkdtemp(path.join(baseDir, 'ludd-esc-gate-e2e-'))
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

describe('escalation gate AC 6.4.1 and AC 6.4.2 force pass', () => {
  it('pauses with max_retries_exceeded and advances on force pass (AC 6.4.1, AC 6.4.2)', async () => {
    const runId = 'esc-run-pass'
    const runDir = path.join(tempDir, '.harness', 'runs', runId)
    const attempts: number[] = []
    let nextRailRan = false

    const harnessPromise = runHarness({
      name: 'escalation-pass-pipeline',
      steps: [
        {
          id: 'test-step',
          run: createCounterAgent(attempts),
          afterStep: [
            execGuardrail({
              command: ['node', '-e', 'process.exit(1)'],
              maxRetries: 1,
              onMaxRetriesExceeded: 'prompt_user',
            }),
            fnGuardrail({
              run: () => {
                nextRailRan = true
                return { status: 'pass' }
              },
            }),
          ],
        },
      ],
    }, { runId, workspaceDir: tempDir })

    const client = await waitForEscalationGate(runDir)
    const status = await client.status()
    expect(status.status).toBe('waiting_for_gate')
    expect(status.activeGate?.gateType).toBe('max_retries_exceeded')
    expect(attempts).toEqual([1, 2])

    await client.resolveGate({ stepId: 'test-step', guardrailIndex: 0, action: 'pass' })
    await client.close()

    const result = await harnessPromise
    expect(result.status).toBe('passed')
    expect(nextRailRan).toBe(true)
    const ledger = readLedgerEvents(runDir)
    expect(ledger.map(e => e.eventType)).toContain('guardrail.passed')
  })
})

describe('escalation gate AC 6.4.2 force skip', () => {
  it('advances to next guardrail on force skip (AC 6.4.2)', async () => {
    const runId = 'esc-run-skip'
    const runDir = path.join(tempDir, '.harness', 'runs', runId)
    const attempts: number[] = []
    let nextRailRan = false

    const harnessPromise = runHarness({
      name: 'escalation-skip-pipeline',
      steps: [
        {
          id: 'skip-step',
          run: createCounterAgent(attempts),
          afterStep: [
            execGuardrail({
              command: ['node', '-e', 'process.exit(1)'],
              maxRetries: 0,
              onMaxRetriesExceeded: 'prompt_user',
            }),
            fnGuardrail({
              run: () => {
                nextRailRan = true
                return { status: 'pass' }
              },
            }),
          ],
        },
      ],
    }, { runId, workspaceDir: tempDir })

    await resolveWaitingGate(runDir, 'skip-step', 'skip')
    const result = await harnessPromise
    expect(result.status).toBe('passed')
    expect(nextRailRan).toBe(true)
    const ledger = readLedgerEvents(runDir)
    expect(ledger.map(e => e.eventType)).toContain('guardrail.skipped')
  })
})

describe('escalation gate AC 6.4.3 abort', () => {
  it('terminates cleanly, records failed status, and unlinks socket on abort (AC 6.4.3)', async () => {
    const runId = 'esc-run-abort'
    const runDir = path.join(tempDir, '.harness', 'runs', runId)
    const attempts: number[] = []

    const harnessPromise = runHarness({
      name: 'escalation-abort-pipeline',
      steps: [
        {
          id: 'abort-step',
          run: createCounterAgent(attempts),
          afterStep: [
            execGuardrail({
              command: ['node', '-e', 'process.exit(1)'],
              maxRetries: 1,
              onMaxRetriesExceeded: 'prompt_user',
            }),
          ],
        },
      ],
    }, { runId, workspaceDir: tempDir })

    await resolveWaitingGate(runDir, 'abort-step', 'abort')
    const result = await harnessPromise
    expect(result.status).toBe('failed')
    expect(result.failedStepId).toBe('abort-step')
    expect(readRunState(runDir).status).toBe('failed')
    expect(fs.existsSync(getControlSocketPath(runDir))).toBe(false)
  })
})

describe('escalation gate policy inheritance', () => {
  it('inherits step-level onMaxRetriesExceeded: prompt_user when guardrail omits it', async () => {
    const runId = 'esc-run-inherit'
    const runDir = path.join(tempDir, '.harness', 'runs', runId)
    const attempts: number[] = []

    const harnessPromise = runHarness({
      name: 'escalation-inherit-pipeline',
      steps: [
        {
          id: 'inherit-step',
          onMaxRetriesExceeded: 'prompt_user',
          run: createCounterAgent(attempts),
          afterStep: [
            execGuardrail({
              command: ['node', '-e', 'process.exit(1)'],
              maxRetries: 0,
            }),
          ],
        },
      ],
    }, { runId, workspaceDir: tempDir })

    await resolveWaitingGate(runDir, 'inherit-step', 'pass')
    const result = await harnessPromise
    expect(result.status).toBe('passed')
  })
})

describe('escalation gate turns circuit breaker', () => {
  it('escalates when maxTotalTurns circuit breaker triggers with prompt_user', async () => {
    const runId = 'esc-run-turns'
    const runDir = path.join(tempDir, '.harness', 'runs', runId)
    const attempts: number[] = []

    const harnessPromise = runHarness({
      name: 'escalation-turns-pipeline',
      steps: [
        {
          id: 'turns-step',
          maxTotalTurns: 1,
          onMaxRetriesExceeded: 'prompt_user',
          run: createCounterAgent(attempts),
          afterStep: [
            execGuardrail({
              command: ['node', '-e', 'process.exit(1)'],
              maxRetries: 5,
            }),
          ],
        },
      ],
    }, { runId, workspaceDir: tempDir })

    await resolveWaitingGate(runDir, 'turns-step', 'pass')
    const result = await harnessPromise
    expect(result.status).toBe('passed')
  })
})
