import type { HarnessConfig, StepConfig } from '../../types/harness.js'
import type { RunStateSnapshot } from '../../types/state.js'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fnGuardrail, humanReviewGuardrail } from '@ludd/guardrails'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createControlClient } from '../../ipc/control-client.js'
import { resolveRunDir, writeRunStateAtomic } from '../../persistence/state-store.js'
import { runHarness } from '../run-harness.js'

let tempDir: string

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-gate-crash-bs-'))
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

function createBaseSnapshot(runId: string): RunStateSnapshot {
  return {
    schemaVersion: 1,
    runId,
    harnessName: 'gate-crash-harness',
    status: 'waiting_for_gate',
    activeStepId: 'step-spec',
    activeGate: null,
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

describe('runHarness mid-gate crash rehydration: function step afterStep gate', () => {
  it('resumes function step afterStep gate without calling runner again', async () => {
    const runId = 'crash-fn-after-step-gate'
    const runDir = resolveRunDir(tempDir, runId)
    const snapshot = createBaseSnapshot(runId)
    snapshot.activeStepId = 'step-fn'
    snapshot.activeGate = {
      stepId: 'step-fn',
      phase: 'afterStep',
      guardrailIndex: 0,
      gateType: 'human_review',
      prompt: 'Review fn output',
      createdAt: '2026-11-09T20:00:00.000Z',
    }
    snapshot.activeStepOutput = 'computed-val'
    writeRunStateAtomic(runDir, snapshot)

    let fnCallCount = 0
    const config: HarnessConfig = {
      name: 'fn-gate-harness',
      steps: [
        {
          id: 'step-fn',
          run: () => {
            fnCallCount += 1
            return 'fresh-computed'
          },
          afterStep: [
            humanReviewGuardrail({ prompt: 'Review fn output' }),
          ],
        },
      ],
    }

    const runPromise = runHarness(config, { runId, workspaceDir: tempDir })
    await resolveAfterWait(runDir)
    const result = await runPromise

    expect(result.status).toBe('passed')
    expect(fnCallCount).toBe(0)
    expect(result.steps['step-fn']?.output).toBe('computed-val')
  })
})

function createBeforeGateStep(
  onG0: () => void,
  onPrompt: (p: string) => void,
): StepConfig {
  return {
    id: 'step-spec',
    beforeStep: [
      fnGuardrail({
        run: () => {
          onG0()
          return { status: 'pass' }
        },
      }),
      humanReviewGuardrail({ prompt: 'Input request:' }),
    ],
    run: {
      __kind: 'agent',
      mode: 'read-only',
      prompt: 'Process request',
      executeTurn: async (input) => {
        onPrompt(input.prompt)
        return {
          output: 'done',
          sessionId: input.sessionId,
        }
      },
    },
  }
}

describe('runHarness mid-gate crash rehydration: beforeStep gate resume', () => {
  it('resumes beforeStep gate starting at guardrailIndex', async () => {
    const runId = 'crash-before-step-gate'
    const runDir = resolveRunDir(tempDir, runId)
    const snapshot = createBaseSnapshot(runId)
    let g0Called = false
    snapshot.activeGate = {
      stepId: 'step-spec',
      phase: 'beforeStep',
      guardrailIndex: 1,
      gateType: 'human_review',
      prompt: 'Input request:',
      createdAt: '2026-11-09T20:00:00.000Z',
    }
    writeRunStateAtomic(runDir, snapshot)

    let capturedPrompt = ''
    const config: HarnessConfig = {
      name: 'before-gate-harness',
      steps: [
        createBeforeGateStep(
          () => {
            g0Called = true
          },
          (p) => {
            capturedPrompt = p
          },
        ),
      ],
    }

    const runPromise = runHarness(config, { runId, workspaceDir: tempDir })
    await resolveAfterWait(runDir, 'pass', 'Feature: User authentication')
    const result = await runPromise

    expect(result.status).toBe('passed')
    expect(g0Called).toBe(false)
    expect(capturedPrompt).toContain('Feature: User authentication')
  })
})
