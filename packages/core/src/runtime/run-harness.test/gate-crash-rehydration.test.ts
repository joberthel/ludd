import type { AgentRunner } from '../../types/agent.js'
import type { HarnessConfig } from '../../types/harness.js'
import type { ActiveGateState, RunStateSnapshot } from '../../types/state.js'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { humanReviewGuardrail } from '@ludd/guardrails'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createControlClient } from '../../ipc/control-client.js'
import { resolveRunDir, writeRunStateAtomic } from '../../persistence/state-store.js'
import { runHarness } from '../run-harness.js'

let tempDir: string

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-gate-crash-'))
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

function createGateWaitingSnapshot(runId: string): RunStateSnapshot {
  const activeGate: ActiveGateState = {
    stepId: 'step-spec',
    phase: 'afterStep',
    guardrailIndex: 0,
    gateType: 'human_review',
    prompt: 'Review generated specification',
    createdAt: '2026-11-09T20:00:00.000Z',
  }
  return {
    schemaVersion: 1,
    runId,
    harnessName: 'gate-crash-harness',
    status: 'waiting_for_gate',
    activeStepId: 'step-spec',
    activeGate,
    activeStepOutput: { spec: 'v1-complete' },
    activeSessionId: 'sess-gate-1',
    activeStepAttempt: 1,
    steps: {},
    updatedAt: '2026-11-09T20:00:00.000Z',
  }
}

async function resolveAfterWait(
  runDir: string,
  action: 'pass' | 'fail' = 'pass',
  feedback?: string,
): Promise<void> {
  for (let i = 0; i < 50; i++) {
    try {
      const client = await createControlClient(runDir)
      const status = await client.status()
      if (status.status === 'waiting_for_gate' && status.activeGate) {
        await client.resolveGate({
          stepId: status.activeGate.stepId,
          guardrailIndex: status.activeGate.guardrailIndex,
          action,
          feedback,
        })
        await client.close()
        return
      }
      await client.close()
    }
    catch {
      // Socket not ready yet
    }
    await new Promise(r => setTimeout(r, 50))
  }
  throw new Error('Timeout waiting for gate')
}

describe('runHarness mid-gate crash rehydration: preserve output without re-executing agent', () => {
  it('resumes afterStep gate without invoking agent executeTurn again', async () => {
    const runId = 'crash-after-step-gate'
    const runDir = resolveRunDir(tempDir, runId)
    writeRunStateAtomic(runDir, createGateWaitingSnapshot(runId))

    let agentCallCount = 0
    let downstreamReceived: unknown

    const agent: AgentRunner = {
      __kind: 'agent',
      mode: 'read-only',
      prompt: 'Generate spec',
      executeTurn: async (input) => {
        agentCallCount += 1
        return {
          output: { spec: 'new-turn' },
          sessionId: input.sessionId,
        }
      },
    }

    const config: HarnessConfig = {
      name: 'gate-crash-harness',
      steps: [
        {
          id: 'step-spec',
          run: agent,
          afterStep: [
            humanReviewGuardrail({ prompt: 'Review generated specification' }),
          ],
        },
        {
          id: 'step-downstream',
          run: async (ctx) => {
            downstreamReceived = ctx.steps['step-spec']?.output
            return 'done'
          },
        },
      ],
    }

    const runPromise = runHarness(config, { runId, workspaceDir: tempDir })
    await resolveAfterWait(runDir)
    const result = await runPromise

    expect(result.status).toBe('passed')
    expect(agentCallCount).toBe(0)
    expect(downstreamReceived).toEqual({ spec: 'v1-complete', sessionId: 'sess-gate-1' })
  })
})

describe('runHarness mid-gate crash rehydration: retry after gate failure', () => {
  it('triggers agent retry when rehydrated afterStep gate fails', async () => {
    const runId = 'crash-after-step-gate-fail'
    const runDir = resolveRunDir(tempDir, runId)
    writeRunStateAtomic(runDir, createGateWaitingSnapshot(runId))

    let attempt2Prompt = ''
    const agent: AgentRunner = {
      __kind: 'agent',
      mode: 'read-only',
      prompt: 'Initial spec',
      executeTurn: async (input) => {
        attempt2Prompt = input.prompt
        return {
          output: { spec: 'v2-fixed' },
          sessionId: input.sessionId,
        }
      },
    }

    const config: HarnessConfig = {
      name: 'gate-crash-fail-harness',
      steps: [
        {
          id: 'step-spec',
          run: agent,
          afterStep: [
            humanReviewGuardrail({ prompt: 'Review spec' }),
          ],
        },
      ],
    }

    const runPromise = runHarness(config, { runId, workspaceDir: tempDir })
    await resolveAfterWait(runDir, 'fail', 'Please add security considerations')
    await resolveAfterWait(runDir, 'pass')
    const result = await runPromise

    expect(result.status).toBe('passed')
    expect(attempt2Prompt).toContain('Please add security considerations')
  })
})
