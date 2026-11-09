import type { HarnessConfig } from '../../types/harness.js'
import type { RunStateSnapshot } from '../../types/state.js'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { appendLedgerEvent } from '../../persistence/ledger-writer.js'
import { resolveRunDir, writeRunStateAtomic } from '../../persistence/state-store.js'
import { runHarness } from '../run-harness.js'

let tempDir: string

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-guardrail-rehydrate-'))
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

function createRetrySnapshot(runId: string): RunStateSnapshot {
  return {
    schemaVersion: 1,
    runId,
    harnessName: 'retry-harness',
    status: 'running',
    activeStepId: 'step-impl',
    activeSessionId: 'sess-crash-1',
    activeStepAttempt: 2,
    activeGuardrailRetries: { 0: 1 },
    steps: {},
    updatedAt: new Date().toISOString(),
  }
}

describe('runHarness crash rehydration: active guardrail retries', () => {
  it('rehydrates activeGuardrailRetries alongside activeSessionId', async () => {
    const runId = 'rehydrate-guardrail-retries'
    const runDir = resolveRunDir(tempDir, runId)
    writeRunStateAtomic(runDir, createRetrySnapshot(runId))

    let capturedAttempt = 0
    let capturedSessionId = ''
    const config: HarnessConfig = {
      name: 'retry-harness',
      steps: [
        {
          id: 'step-impl',
          run: {
            __kind: 'agent',
            mode: 'workspace-write',
            prompt: 'Fix issue',
            executeTurn: async (input) => {
              capturedAttempt = input.attempt
              capturedSessionId = input.sessionId
              return {
                output: { code: 'fixed' },
                sessionId: input.sessionId,
              }
            },
          },
        },
      ],
    }

    const res = await runHarness(config, { runId, workspaceDir: tempDir })
    expect(res.status).toBe('passed')
    expect(capturedAttempt).toBe(2)
    expect(capturedSessionId).toBe('sess-crash-1')
  })
})

function setupPromptRehydrationScenario(runDir: string, runId: string): void {
  const snapshot: RunStateSnapshot = {
    schemaVersion: 1,
    runId,
    harnessName: 'prompt-rehydrate-harness',
    status: 'running',
    activeStepId: 'step-impl',
    activeSessionId: 'sess-prompt-1',
    activeStepAttempt: 2,
    steps: {},
    logs: {
      'step-impl-1': {
        logKey: 'step-impl-1',
        format: 'text',
      },
    },
    updatedAt: new Date().toISOString(),
  }
  writeRunStateAtomic(runDir, snapshot)

  appendLedgerEvent(runDir, {
    schemaVersion: 1,
    timestamp: new Date().toISOString(),
    runId,
    stepId: 'step-impl',
    eventType: 'step.retry',
    payload: {
      attempt: 2,
      sessionId: 'sess-prompt-1',
      reason: 'guardrail_failed',
      issues: {
        guardrailIndex: 0,
        verdict: {
          status: 'fail',
          body: 'phpunit failed',
          logKey: 'step-impl-1',
        },
      },
    },
  })
}

describe('runHarness crash rehydration: prompt rehydration', () => {
  it('reconstructs prompt with logKey and MCP tools on attempt > 1', async () => {
    const runId = 'rehydrate-guardrail-prompt'
    const runDir = resolveRunDir(tempDir, runId)
    setupPromptRehydrationScenario(runDir, runId)

    let capturedPrompt = ''
    const config: HarnessConfig = {
      name: 'prompt-rehydrate-harness',
      steps: [
        {
          id: 'step-impl',
          run: {
            __kind: 'agent',
            mode: 'workspace-write',
            prompt: 'Original instruction for step',
            executeTurn: async (input) => {
              capturedPrompt = input.prompt
              return {
                output: { done: true },
                sessionId: input.sessionId,
              }
            },
          },
        },
      ],
    }

    const res = await runHarness(config, { runId, workspaceDir: tempDir })
    expect(res.status).toBe('passed')
    expect(capturedPrompt).toContain('The step failed afterStep guardrail #0.')
    expect(capturedPrompt).toContain('Detailed failure log has been offloaded to MCP logKey "step-impl-1"')
    expect(capturedPrompt).toContain('read_log_page, read_log_lines, search_log')
    expect(capturedPrompt).toContain('Original instruction for step')
  })
})

describe('runHarness crash rehydration: granted budgets', () => {
  it('preserves grantedExtraRetries and grantedExtraTurns in snapshot on rehydration', async () => {
    const runId = 'rehydrate-granted-budgets'
    const runDir = resolveRunDir(tempDir, runId)
    const snapshot: RunStateSnapshot = {
      ...createRetrySnapshot(runId),
      grantedExtraRetries: { 'step-impl:0': 2 },
      grantedExtraTurns: { 'step-impl': 3 },
    }
    writeRunStateAtomic(runDir, snapshot)

    const config: HarnessConfig = {
      name: 'retry-harness',
      steps: [
        {
          id: 'step-impl',
          run: async () => 'ok',
        },
      ],
    }

    const res = await runHarness(config, { runId, workspaceDir: tempDir })
    expect(res.status).toBe('passed')
  })
})
