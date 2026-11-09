import type { AgentRunner } from '../../types/agent.js'
import type { ControlClient } from '../../types/ipc.js'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { humanReviewGuardrail } from '@ludd/guardrails'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createControlClient } from '../../ipc/control-client.js'
import { readLedgerEvents } from '../../persistence/ledger-writer.js'
import { readRunState } from '../../persistence/state-store.js'
import { JSON_RPC_INVALID_PARAMS } from '../../types/ipc.js'
import { runHarness } from '../run-harness.js'

function createReviewHarnessConfig(agentRunner: AgentRunner) {
  return {
    name: 'human-review-pipeline',
    steps: [
      {
        id: 'clarify-feature',
        beforeStep: [
          humanReviewGuardrail({
            prompt: 'Please describe the feature scope or change request:',
          }),
        ],
        run: agentRunner,
      },
    ],
  }
}

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

async function verifyActiveGateAndMismatches(client: ControlClient): Promise<void> {
  const statusSnapshot = await client.status()
  expect(statusSnapshot.status).toBe('waiting_for_gate')
  expect(statusSnapshot.activeGate).toEqual({
    stepId: 'clarify-feature',
    phase: 'beforeStep',
    guardrailIndex: 0,
    gateType: 'human_review',
    prompt: 'Please describe the feature scope or change request:',
    createdAt: expect.any(String),
  })

  await expect(client.resolveGate({ stepId: 'wrong-step', action: 'pass' })).rejects.toMatchObject({
    code: JSON_RPC_INVALID_PARAMS,
  })
  await expect(client.resolveGate({
    stepId: 'clarify-feature',
    guardrailIndex: 99,
    action: 'pass',
  })).rejects.toMatchObject({
    code: JSON_RPC_INVALID_PARAMS,
  })
}

function verifyLedgerAndStateEvents(runDir: string): void {
  const finalState = readRunState(runDir)
  expect(finalState.status).toBe('passed')
  expect(finalState.activeGate).toBeNull()

  const ledger = readLedgerEvents(runDir)
  const eventTypes = ledger.map(e => e.eventType)
  expect(eventTypes).toContain('gate.waiting')
  expect(eventTypes).toContain('gate.resolved')
  expect(eventTypes).toContain('guardrail.passed')

  const gateWaitingEvent = ledger.find(e => e.eventType === 'gate.waiting')
  expect(gateWaitingEvent?.payload).toMatchObject({
    phase: 'beforeStep',
    guardrailIndex: 0,
    gateType: 'human_review',
    prompt: 'Please describe the feature scope or change request:',
  })

  const gateResolvedEvent = ledger.find(e => e.eventType === 'gate.resolved')
  expect(gateResolvedEvent?.payload).toMatchObject({
    stepId: 'clarify-feature',
    guardrailIndex: 0,
    action: 'pass',
    feedback: 'Implement Google OAuth2 and JWT token validation',
  })
}

describe('humanReviewGuardrail in beforeStep and gate.resolve over control.sock', () => {
  let tempDir: string

  beforeEach(async () => {
    const baseDir = process.platform === 'win32'
      ? os.tmpdir()
      : '/tmp'
    tempDir = await mkdtemp(path.join(baseDir, 'ludd-hr-e2e-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('pauses at 0% CPU, serves waiting_for_gate via RPC, and resumes upon pass with feedback', async () => {
    const runId = 'hr-gate-run'
    const runDir = path.join(tempDir, '.harness', 'runs', runId)
    let turn1ReceivedPrompt = ''

    const mockAgent: AgentRunner = {
      __kind: 'agent',
      mode: 'read-only',
      prompt: 'Analyze feature request and produce specification',
      executeTurn: async (input) => {
        turn1ReceivedPrompt = input.prompt
        return {
          output: { spec: 'Auth Specification generated from feedback' },
          sessionId: input.sessionId,
        }
      },
    }

    const harnessPromise = runHarness(
      createReviewHarnessConfig(mockAgent),
      { runId, workspaceDir: tempDir },
    )

    const client = await waitForGateWaiting(runDir)
    await verifyActiveGateAndMismatches(client)

    const resolutionResult = await client.resolveGate({
      stepId: 'clarify-feature',
      guardrailIndex: 0,
      action: 'pass',
      feedback: 'Implement Google OAuth2 and JWT token validation',
    })
    expect(resolutionResult).toEqual({ ok: true })
    await client.close()

    const runResult = await harnessPromise
    expect(runResult.status).toBe('passed')
    expect(turn1ReceivedPrompt).toContain('Implement Google OAuth2 and JWT token validation')
    expect(turn1ReceivedPrompt).toContain('Context from beforeStep guardrails is available via MCP tools:')
    expect(turn1ReceivedPrompt).toContain('Analyze feature request and produce specification')

    verifyLedgerAndStateEvents(runDir)
  })
})
