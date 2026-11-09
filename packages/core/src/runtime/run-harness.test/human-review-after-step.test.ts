import type { AgentRunner } from '../../types/agent.js'
import type { HarnessConfig } from '../../types/harness.js'
import type { ControlClient } from '../../types/ipc.js'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fnGuardrail, humanReviewGuardrail } from '@ludd/guardrails'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createControlClient } from '../../ipc/control-client.js'
import { readLedgerEvents } from '../../persistence/ledger-writer.js'
import { readRunState } from '../../persistence/state-store.js'
import { runHarness } from '../run-harness.js'

async function waitForGateWaiting(runDir: string): Promise<ControlClient> {
  let client: ControlClient | undefined
  for (let i = 0; i < 50; i++) {
    try {
      if (!client) {
        client = await createControlClient(runDir)
      }
      const state = await client.status()
      if (state.status === 'waiting_for_gate' && state.activeGate) {
        return client
      }
    }
    catch {
      // Socket may not be ready yet
    }
    await new Promise(r => setTimeout(r, 50))
  }
  throw new Error('Timeout waiting for control server active gate')
}

function createSchemaAgent(prompts: string[], sessions: string[]): AgentRunner {
  return {
    __kind: 'agent',
    mode: 'workspace-write',
    prompt: 'Design database schema',
    executeTurn: async (input) => {
      prompts.push(input.prompt)
      sessions.push(input.sessionId)
      const dbEngine = input.attempt === 1
        ? 'MySQL'
        : 'PostgreSQL'
      const tables = ['users', 'tokens']
      const stepOutput = { engine: dbEngine, tables }
      return {
        output: stepOutput,
        sessionId: input.sessionId,
      }
    },
  }
}

async function verifyInitialGateAndFail(runDir: string): Promise<void> {
  const client = await waitForGateWaiting(runDir)
  const status = await client.status()
  expect(status.status).toBe('waiting_for_gate')
  expect(status.activeGate).toEqual({
    stepId: 'design-schema',
    phase: 'afterStep',
    guardrailIndex: 0,
    gateType: 'human_review',
    prompt: 'Review database choice: MySQL',
    createdAt: expect.any(String),
  })

  await client.resolveGate({
    stepId: 'design-schema',
    guardrailIndex: 0,
    action: 'fail',
    feedback: 'Use PostgreSQL instead of MySQL',
  })
  await client.close()
}

async function verifyTurn2GateAndPass(runDir: string): Promise<void> {
  const client = await waitForGateWaiting(runDir)
  const status = await client.status()
  expect(status.status).toBe('waiting_for_gate')
  expect(status.activeGate?.prompt).toBe('Review database choice: PostgreSQL')

  await client.resolveGate({
    stepId: 'design-schema',
    guardrailIndex: 0,
    action: 'pass',
  })
  await client.close()
}

function verifyEventsAndState(runDir: string): void {
  const ledger = readLedgerEvents(runDir)
  const eventTypes = ledger.map(e => e.eventType)
  expect(eventTypes).toContain('gate.waiting')
  expect(eventTypes).toContain('gate.resolved')
  expect(eventTypes).toContain('guardrail.failed')
  expect(eventTypes).toContain('step.retry')
  expect(eventTypes).toContain('guardrail.passed')
  expect(readRunState(runDir).status).toBe('passed')
}

function createRestartConfig(onPreCheck: () => void): HarnessConfig {
  const preCheckRail = fnGuardrail({
    run: () => {
      onPreCheck()
      return { status: 'pass' }
    },
  })
  const reviewRail = humanReviewGuardrail({
    prompt: (ctx: any) => `Review doc version ${ctx.step.output?.version}`,
  })
  return {
    name: 'after-step-chain-restart',
    steps: [
      {
        id: 'doc-step',
        run: {
          __kind: 'agent',
          mode: 'workspace-write',
          prompt: 'Produce document',
          executeTurn: async input => ({
            output: { version: input.attempt },
            sessionId: input.sessionId,
          }),
        },
        afterStep: [preCheckRail, reviewRail],
      },
    ],
  }
}

describe('humanReviewGuardrail afterStep self-healing flow', () => {
  let tempDir: string

  beforeEach(async () => {
    const baseDir = process.platform === 'win32'
      ? os.tmpdir()
      : '/tmp'
    tempDir = await mkdtemp(path.join(baseDir, 'ludd-hr-after-e2e-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('formats ctx.step.output into prompt, heals on fail with feedback, and completes on pass', async () => {
    const runId = 'hr-after-run-1'
    const runDir = path.join(tempDir, '.harness', 'runs', runId)
    const promptsReceived: string[] = []
    const sessionsSeen: string[] = []

    const harnessPromise = runHarness({
      name: 'after-step-human-review-pipeline',
      steps: [
        {
          id: 'design-schema',
          run: createSchemaAgent(promptsReceived, sessionsSeen),
          afterStep: [
            humanReviewGuardrail({
              prompt: (ctx: any) => `Review database choice: ${ctx.step.output?.engine}`,
            }),
          ],
        },
      ],
    }, { runId, workspaceDir: tempDir })

    await verifyInitialGateAndFail(runDir)
    await verifyTurn2GateAndPass(runDir)

    const result = await harnessPromise
    expect(result.status).toBe('passed')
    expect(sessionsSeen[0]).toBe(sessionsSeen[1])
    expect(promptsReceived[1]).toContain('The step failed afterStep guardrail #0.')
    expect(promptsReceived[1]).toContain('Summary: Use PostgreSQL instead of MySQL')
    expect(promptsReceived[1]).toContain('Detailed failure log has been offloaded to MCP logKey')

    verifyEventsAndState(runDir)
  })
})

describe('humanReviewGuardrail afterStep chain restart', () => {
  let tempDir: string

  beforeEach(async () => {
    const baseDir = process.platform === 'win32'
      ? os.tmpdir()
      : '/tmp'
    tempDir = await mkdtemp(path.join(baseDir, 'ludd-hr-restart-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('restarts afterStep chain strictly from index 0 on failure', async () => {
    const runId = 'hr-chain-restart-run'
    const runDir = path.join(tempDir, '.harness', 'runs', runId)
    let preExecutions = 0

    const harnessPromise = runHarness(
      createRestartConfig(() => {
        preExecutions += 1
      }),
      { runId, workspaceDir: tempDir },
    )

    const client1 = await waitForGateWaiting(runDir)
    expect(preExecutions).toBe(1)
    await client1.resolveGate({
      stepId: 'doc-step',
      guardrailIndex: 1,
      action: 'fail',
      feedback: 'Increment version and add diagrams',
    })
    await client1.close()

    const client2 = await waitForGateWaiting(runDir)
    expect(preExecutions).toBe(2)
    await client2.resolveGate({ stepId: 'doc-step', guardrailIndex: 1, action: 'pass' })
    await client2.close()

    const result = await harnessPromise
    expect(result.status).toBe('passed')
    expect(preExecutions).toBe(2)
  })
})
