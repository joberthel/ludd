import type { AgentRunner, AgentTurnInput } from '../../types/agent.js'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { MaxTotalTurnsExceededError } from '../../errors/max-total-turns-exceeded-error.js'
import { releaseRunPidLock } from '../../persistence/pid-lock.js'
import { readRunState, resolveRunDir, writeRunStateAtomic } from '../../persistence/state-store.js'
import { runHarness } from '../run-harness.js'

function createBreakerAgent(turns: AgentTurnInput[]): AgentRunner<{ value: string }> {
  let hasSimulatedCrash = false
  return {
    __kind: 'agent',
    mode: 'read-only',
    prompt: 'produce valid',
    executeTurn: async (input) => {
      turns.push(input)
      if (input.attempt === 1) {
        return {
          output: { value: 'invalid-turn-1' },
          sessionId: input.sessionId,
        }
      }
      if (input.attempt === 2 && !hasSimulatedCrash) {
        hasSimulatedCrash = true
        throw new Error('simulated crash on attempt 2')
      }
      return {
        output: { value: 'invalid-still' },
        sessionId: input.sessionId,
      }
    },
  }
}

describe('runHarness mid-step agent crash rehydration (AC 3.5.1)', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-agent-crash-'))
  })
  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('reuses activeSessionId from state.json after mid-turn crash', async () => {
    let process1SessionId: string | undefined
    let process2SessionId: string | undefined
    let hasCrashed = false

    const agent: AgentRunner<string> = {
      __kind: 'agent',
      mode: 'read-only',
      prompt: 'do initial triage',
      executeTurn: async (input) => {
        if (!hasCrashed) {
          hasCrashed = true
          process1SessionId = input.sessionId
          throw new Error('simulated process crash')
        }
        process2SessionId = input.sessionId
        return { output: 'triage complete', sessionId: input.sessionId }
      },
    }

    const runId = 'crash-sess-run'
    const harness = {
      name: 'mid-step-crash-pipeline',
      steps: [
        { id: 'step-triage', run: agent },
      ],
    }

    const run1 = await runHarness(harness, { workspaceDir: tempDir, runId })
    expect(run1.status).toBe('failed')
    expect(process1SessionId).toBeDefined()

    const runDir = resolveRunDir(tempDir, runId)
    const midCrashState = readRunState(runDir)
    expect(midCrashState.activeSessionId).toBe(process1SessionId)

    releaseRunPidLock(runDir)

    const run2 = await runHarness(harness, { workspaceDir: tempDir, runId })
    expect(run2.status).toBe('passed')
    expect(process2SessionId).toBe(process1SessionId)
  })
})

describe('runHarness fallback when activeStepAttempt missing in state', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-agent-legacy-'))
  })
  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('defaults activeStepAttempt to 1 if missing in previous state', async () => {
    let capturedAttempt: number | undefined
    const agent: AgentRunner<string> = {
      __kind: 'agent',
      mode: 'read-only',
      prompt: 'legacy step',
      executeTurn: async (input) => {
        capturedAttempt = input.attempt
        return { output: 'legacy-done', sessionId: input.sessionId }
      },
    }
    const runId = 'legacy-attempt-run'
    const harness = {
      name: 'legacy-pipeline',
      steps: [
        { id: 'step-legacy', run: agent },
      ],
    }
    const runDir = resolveRunDir(tempDir, runId)
    writeRunStateAtomic(runDir, {
      schemaVersion: 1,
      runId,
      harnessName: 'legacy-pipeline',
      status: 'failed',
      activeStepId: 'step-legacy',
      activeSessionId: 'legacy-sess-id',
      steps: {},
      updatedAt: new Date().toISOString(),
    })
    const result = await runHarness(harness, { workspaceDir: tempDir, runId })
    expect(result.status).toBe('passed')
    expect(capturedAttempt).toBe(1)
  })
})

describe('runHarness cumulative attempt counter preservation across crashes (AC 3.5.2)', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-agent-attempt-crash-'))
  })
  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('preserves attempt counter across restarts enforcing maxTotalTurns circuit breaker', async () => {
    const turns: AgentTurnInput[] = []
    const schema = z.object({
      value: z.literal('valid'),
    })
    const runId = 'crash-attempt-run'
    const harness = {
      name: 'attempt-preservation-pipeline',
      steps: [
        {
          id: 'step-breaker',
          run: createBreakerAgent(turns),
          outputSchema: schema,
          maxTotalTurns: 3,
        },
      ],
    }

    const run1 = await runHarness(harness, { workspaceDir: tempDir, runId })
    expect(run1.status).toBe('failed')

    const runDir = resolveRunDir(tempDir, runId)
    releaseRunPidLock(runDir)

    const run2 = await runHarness(harness, { workspaceDir: tempDir, runId })
    expect(run2.status).toBe('failed')
    expect(run2.error).toBeInstanceOf(MaxTotalTurnsExceededError)

    const maxError = run2.error as MaxTotalTurnsExceededError
    expect(maxError.maxTotalTurns).toBe(3)
    expect(turns.map(t => t.attempt)).toEqual([1, 2, 2, 3])
  })
})

describe('runHarness active session and attempt state clearing (AC 3.5.3)', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-agent-state-clear-'))
  })
  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('resets activeSessionId to null and activeStepAttempt to 1 when step completes', async () => {
    const agent: AgentRunner<string> = {
      __kind: 'agent',
      mode: 'read-only',
      prompt: 'execute and pass',
      executeTurn: async input => ({ output: 'passed-output', sessionId: input.sessionId }),
    }

    const result = await runHarness({
      name: 'state-clear-pipeline',
      steps: [
        { id: 'step-agent-clear', run: agent },
        {
          id: 'step-skip',
          if: () => false,
          run: () => 'skipped',
        },
      ],
    }, { workspaceDir: tempDir })

    expect(result.status).toBe('passed')
    const runDir = resolveRunDir(tempDir, result.runId)
    const finalState = readRunState(runDir)

    expect(finalState.activeStepId).toBeNull()
    expect(finalState.activeSessionId).toBeNull()
    expect(finalState.activeStepAttempt).toBe(1)
  })
})
