import type { AgentRunner } from '../../types/agent.js'
import type { HarnessConfig } from '../../types/harness.js'
import type { GateResolveParams } from '../../types/ipc.js'
import type { ActiveGateState, RunStateSnapshot } from '../../types/state.js'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fnGuardrail } from '@ludd/guardrails'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createControlClient } from '../../ipc/control-client.js'
import { resolveRunDir, writeRunStateAtomic } from '../../persistence/state-store.js'
import { runHarness } from '../run-harness.js'

let tempDir: string

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-gate-escalate-'))
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

function createEscalationSnapshot(runId: string): RunStateSnapshot {
  const activeGate: ActiveGateState = {
    stepId: 'step-build',
    phase: 'afterStep',
    guardrailIndex: 0,
    gateType: 'max_retries_exceeded',
    prompt: 'Guardrail #0 in step "step-build" exceeded maxRetries.',
    createdAt: '2026-11-09T20:00:00.000Z',
  }
  return {
    schemaVersion: 1,
    runId,
    harnessName: 'escalate-crash-harness',
    workflowName: 'escalate-crash-harness',
    status: 'waiting_for_gate',
    activeStepId: 'step-build',
    activeGate,
    activeStepOutput: { code: 'bad', sessionId: 'sess-build-1' },
    activeSessionId: 'sess-build-1',
    activeStepAttempt: 1,
    activeGuardrailRetries: { 0: 1 },
    steps: {},
    updatedAt: '2026-11-09T20:00:00.000Z',
  }
}

async function resolveEscalation(runDir: string, action: 'pass' | 'retry' = 'retry'): Promise<void> {
  const resolveParams: GateResolveParams = action === 'retry'
    ? {
        stepId: 'step-build',
        guardrailIndex: 0,
        action: 'retry',
        addRetries: 1,
        feedback: 'Fix typo',
      }
    : {
        stepId: 'step-build',
        guardrailIndex: 0,
        action: 'pass',
      }
  for (let i = 0; i < 50; i++) {
    try {
      const client = await createControlClient(runDir)
      const status = await client.status()
      if (status.status === 'waiting_for_gate' && status.activeGate) {
        await client.resolveGate(resolveParams)
        await client.close()
        return
      }
      await client.close()
    }
    catch {
      // Waiting
    }
    await new Promise(r => setTimeout(r, 50))
  }
}

describe('runHarness escalation gate crash rehydration - retry', () => {
  it('resumes escalation gate and handles retry resolution cleanly', async () => {
    const runId = 'escalate-rehydrate-run'
    const runDir = resolveRunDir(tempDir, runId)
    writeRunStateAtomic(runDir, createEscalationSnapshot(runId))

    let attempt2Prompt = ''
    let guardrailCheckCount = 0

    const agent: AgentRunner = {
      __kind: 'agent',
      mode: 'workspace-write',
      prompt: 'Build step',
      executeTurn: async (input) => {
        attempt2Prompt = input.prompt
        return {
          output: { code: 'good' },
          sessionId: input.sessionId,
        }
      },
    }

    const config: HarnessConfig = {
      name: 'escalate-crash-harness',
      steps: [
        {
          id: 'step-build',
          run: agent,
          afterStep: [
            fnGuardrail({
              maxRetries: 0,
              onMaxRetriesExceeded: 'prompt_user',
              run: () => {
                guardrailCheckCount += 1
                return { status: 'pass' }
              },
            }),
          ],
        },
      ],
    }

    const runPromise = runHarness(config, { runId, workspaceDir: tempDir })
    await resolveEscalation(runDir)
    const result = await runPromise

    expect(result.status).toBe('passed')
    expect(guardrailCheckCount).toBe(1)
    expect(attempt2Prompt).toContain('Fix typo')
  })
})

describe('runHarness escalation gate crash rehydration - pass', () => {
  it('resumes escalation gate and completes when client resolves with pass', async () => {
    const runId = 'escalate-rehydrate-pass-run'
    const runDir = resolveRunDir(tempDir, runId)
    writeRunStateAtomic(runDir, createEscalationSnapshot(runId))

    const config: HarnessConfig = {
      name: 'escalate-crash-harness',
      steps: [
        {
          id: 'step-build',
          run: async () => ({ code: 'good' }),
          afterStep: [
            fnGuardrail({
              maxRetries: 0,
              onMaxRetriesExceeded: 'prompt_user',
              run: () => ({ status: 'fail' }),
            }),
          ],
        },
      ],
    }

    const runPromise = runHarness(config, { runId, workspaceDir: tempDir })
    await resolveEscalation(runDir, 'pass')
    const result = await runPromise

    expect(result.status).toBe('passed')
  })
})
