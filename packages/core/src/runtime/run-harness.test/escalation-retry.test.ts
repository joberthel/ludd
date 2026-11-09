import type { AgentRunner } from '../../types/agent.js'
import type { ControlClient } from '../../types/ipc.js'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fnGuardrail } from '@ludd/guardrails'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createControlClient } from '../../ipc/control-client.js'
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
    catch { /* retry */ }
    await new Promise(r => setTimeout(r, 50))
  }
  throw new Error('Timeout waiting for escalation gate')
}

function createAgent(prompts: string[], attempts: number[]): AgentRunner {
  return {
    __kind: 'agent',
    mode: 'workspace-write',
    prompt: 'Fix the bug',
    executeTurn: async (input) => {
      prompts.push(input.prompt)
      attempts.push(input.attempt)
      return {
        output: { attempt: input.attempt },
        sessionId: input.sessionId,
      }
    },
  }
}

async function startClockHarness(
  tempDir: string,
  runId: string,
  prompts: string[],
  attempts: number[],
  onSecondRail: () => void,
) {
  return runHarness({
    name: 'esc-retry-harness',
    steps: [
      {
        id: 'clock-step',
        run: createAgent(prompts, attempts),
        afterStep: [
          fnGuardrail({
            maxRetries: 1,
            onMaxRetriesExceeded: 'prompt_user',
            run: ctx => ({
              status: ctx.step.attempt >= 3
                ? 'pass'
                : 'fail',
              body: ctx.step.attempt >= 3
                ? 'all tests pass'
                : 'clock mock failed',
            }),
          }),
          fnGuardrail({
            run: () => {
              onSecondRail()
              return { status: 'pass' }
            },
          }),
        ],
      },
    ],
  }, { runId, workspaceDir: tempDir })
}

function assertRetryState(runDir: string, prompts: string[], attempts: number[]): void {
  expect(attempts).toEqual([1, 2, 3])
  expect(prompts[2]).toContain('Fix the mock clock in DateServiceTest')

  const snapshot = readRunState(runDir)
  expect(snapshot.grantedExtraRetries?.['clock-step:0']).toBe(2)
  expect(snapshot.grantedExtraTurns?.['clock-step']).toBe(2)

  const ledger = readLedgerEvents(runDir)
  const retryEvents = ledger.filter(e => e.eventType === 'step.retry')
  expect(retryEvents).toHaveLength(2)
  expect((retryEvents[1].payload.issues as any).feedback).toBe('Fix the mock clock in DateServiceTest')
}

let tempDir: string

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-esc-retry-e2e-'))
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

describe('escalation gate action: retry budget extension and hint (AC 6.5.1, AC 6.5.2)', () => {
  it('extends retry and turn budget by 2, passes hint, restarts chain and passes', async () => {
    const runId = 'esc-retry-success'
    const runDir = path.join(tempDir, '.harness', 'runs', runId)
    const prompts: string[] = []
    const attempts: number[] = []
    let secondRailRan = false

    const harnessPromise = startClockHarness(tempDir, runId, prompts, attempts, () => {
      secondRailRan = true
    })

    const client = await waitForEscalationGate(runDir)
    expect(attempts).toEqual([1, 2])

    await client.resolveGate({
      stepId: 'clock-step',
      guardrailIndex: 0,
      action: 'retry',
      addRetries: 2,
      feedback: 'Fix the mock clock in DateServiceTest',
    })
    await client.close()

    const result = await harnessPromise
    expect(result.status).toBe('passed')
    expect(secondRailRan).toBe(true)
    assertRetryState(runDir, prompts, attempts)
  })
})

describe('escalation gate exhaustion of granted retries (AC 6.5.3)', () => {
  it('re-opens escalation gate deterministically when newly granted retries are exhausted', async () => {
    const runId = 'esc-retry-exhaust'
    const runDir = path.join(tempDir, '.harness', 'runs', runId)
    const prompts: string[] = []
    const attempts: number[] = []

    const harnessPromise = runHarness({
      name: 'esc-exhaust-harness',
      steps: [
        {
          id: 'failing-step',
          run: createAgent(prompts, attempts),
          afterStep: [
            fnGuardrail({
              maxRetries: 0,
              onMaxRetriesExceeded: 'prompt_user',
              run: () => ({ status: 'fail', body: 'persistent failure' }),
            }),
          ],
        },
      ],
    }, { runId, workspaceDir: tempDir })

    const client1 = await waitForEscalationGate(runDir)
    expect(attempts).toEqual([1])
    await client1.resolveGate({
      stepId: 'failing-step',
      guardrailIndex: 0,
      action: 'retry',
      addRetries: 2,
    })
    await client1.close()

    const client2 = await waitForEscalationGate(runDir)
    expect(attempts).toEqual([1, 2, 3])
    await client2.resolveGate({ stepId: 'failing-step', guardrailIndex: 0, action: 'pass' })
    await client2.close()

    const result = await harnessPromise
    expect(result.status).toBe('passed')
  })
})
