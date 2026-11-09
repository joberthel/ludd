import type { AgentRunner, AgentTurnInput } from '../../types/agent.js'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { MaxTotalTurnsExceededError } from '../../errors/max-total-turns-exceeded-error.js'
import { StepArtifactValidationError } from '../../errors/step-artifact-validation-error.js'
import { readLedgerEvents } from '../../persistence/ledger-writer.js'
import { releaseRunPidLock } from '../../persistence/pid-lock.js'
import { resolveRunDir } from '../../persistence/state-store.js'
import { runHarness } from '../run-harness.js'
import { putMcpArtifact } from './artifact-helpers.js'

describe('runHarness artifact validation AC 4.2.1: valid artifacts pass', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-art-val-pass-'))
  })
  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('passes when agent writes valid artifacts conforming to rules via MCP', async () => {
    const todosSchema = z.array(z.object({
      id: z.string(),
      title: z.string(),
    })).min(1)
    const agent: AgentRunner<string> = {
      __kind: 'agent',
      mode: 'read-only',
      prompt: 'produce spec and todos',
      executeTurn: async (input) => {
        await putMcpArtifact(input.mcpServerUrl, input.mcpAuthToken, 'spec.md', '# Feature Spec\nDetails.')
        await putMcpArtifact(input.mcpServerUrl, input.mcpAuthToken, 'todos.json', JSON.stringify([
          { id: '1', title: 'Write tests' },
        ]))
        return { output: 'complete', sessionId: input.sessionId }
      },
    }

    const result = await runHarness({
      name: 'valid-artifacts-pipeline',
      steps: [
        {
          id: 'step-spec',
          run: agent,
          artifacts: {
            'spec.md': {
              nonEmpty: true,
              validate: c => c.startsWith('# Feature Spec'),
            },
            'todos.json': { schema: todosSchema },
          },
        },
      ],
    }, { workspaceDir: tempDir })

    expect(result.status).toBe('passed')
    const runDir = resolveRunDir(tempDir, result.runId)
    const ledger = readLedgerEvents(runDir)
    expect(ledger.some(e => e.eventType === 'step.retry')).toBe(false)
  })
})

describe('runHarness artifact validation AC 4.2.2: agent self-healing retry', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-art-val-retry-'))
  })
  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('self-heals on attempt 2 when missing artifact is created on retry', async () => {
    const turns: AgentTurnInput[] = []
    const agent: AgentRunner<string> = {
      __kind: 'agent',
      mode: 'read-only',
      prompt: 'produce spec',
      executeTurn: async (input) => {
        turns.push(input)
        if (input.attempt > 1) {
          await putMcpArtifact(input.mcpServerUrl, input.mcpAuthToken, 'spec.md', '# Spec content')
        }
        return { output: 'done', sessionId: input.sessionId }
      },
    }

    const result = await runHarness({
      name: 'retry-harness',
      steps: [
        {
          id: 'step-retry',
          run: agent,
          artifacts: {
            'spec.md': { nonEmpty: true },
          },
        },
      ],
    }, { workspaceDir: tempDir })

    expect(result.status).toBe('passed')
    expect(turns).toHaveLength(2)
    expect(turns[0].sessionId).toBe(turns[1].sessionId)
    expect(turns[1].prompt).toContain('The step artifacts failed validation:')
    expect(turns[1].prompt).toContain('Artifact "spec.md" was not created.')

    const runDir = resolveRunDir(tempDir, result.runId)
    const retries = readLedgerEvents(runDir).filter(e => e.eventType === 'step.retry')
    expect(retries).toHaveLength(1)
    expect(retries[0].payload).toMatchObject({
      attempt: 2,
      sessionId: turns[0].sessionId,
      reason: 'artifact_validation_failed',
    })
  })
})

describe('runHarness artifact validation AC 4.2.3: maxTotalTurns circuit breaker', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-art-val-breaker-'))
  })
  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('halts when attempts reach maxTotalTurns and records failure in ledger', async () => {
    let callCount = 0
    const agent: AgentRunner<string> = {
      __kind: 'agent',
      mode: 'read-only',
      prompt: 'never produces artifact',
      executeTurn: async (input) => {
        callCount += 1
        return { output: 'ignored', sessionId: input.sessionId }
      },
    }

    const result = await runHarness({
      name: 'breaker-harness',
      steps: [
        {
          id: 'step-breaker',
          run: agent,
          maxTotalTurns: 3,
          artifacts: {
            'output.txt': { nonEmpty: true },
          },
        },
      ],
    }, { workspaceDir: tempDir })

    expect(result.status).toBe('failed')
    expect(callCount).toBe(3)
    expect(result.failedStepId).toBe('step-breaker')
    expect(result.error).toBeInstanceOf(MaxTotalTurnsExceededError)

    const maxError = result.error as MaxTotalTurnsExceededError
    expect(maxError.stepId).toBe('step-breaker')
    expect(maxError.maxTotalTurns).toBe(3)
    expect(maxError.lastError).toBeInstanceOf(StepArtifactValidationError)

    const runDir = resolveRunDir(tempDir, result.runId)
    const ledger = readLedgerEvents(runDir)
    expect(ledger.filter(e => e.eventType === 'step.retry')).toHaveLength(2)
  })
})

describe('runHarness artifact validation AC 4.2.4: deterministic TS step failure', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-art-val-ts-'))
  })
  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('fails immediately on Attempt 1 without retry when deterministic step violates artifacts', async () => {
    let executionCount = 0
    const result = await runHarness({
      name: 'ts-step-harness',
      steps: [
        {
          id: 'deterministic-step',
          artifacts: {
            'required.txt': { nonEmpty: true },
          },
          run: async () => {
            executionCount += 1
            return 'done'
          },
        },
      ],
    }, { workspaceDir: tempDir })

    expect(result.status).toBe('failed')
    expect(executionCount).toBe(1)
    expect(result.failedStepId).toBe('deterministic-step')
    expect(result.error).toBeInstanceOf(StepArtifactValidationError)

    const runDir = resolveRunDir(tempDir, result.runId)
    const ledger = readLedgerEvents(runDir)
    expect(ledger.some(e => e.eventType === 'step.retry')).toBe(false)
  })
})

function createRehydrationAgent(state: { crashed: boolean, prompt: string }): AgentRunner<string> {
  return {
    __kind: 'agent',
    mode: 'read-only',
    prompt: 'write spec.md',
    executeTurn: async (input) => {
      if (input.attempt === 1) {
        return { output: 'missed-artifact', sessionId: input.sessionId }
      }
      state.prompt = input.prompt
      if (!state.crashed) {
        state.crashed = true
        throw new Error('mid-turn process crash on attempt 2')
      }
      await putMcpArtifact(input.mcpServerUrl, input.mcpAuthToken, 'spec.md', '# Recovered Spec')
      return { output: 'recovered', sessionId: input.sessionId }
    },
  }
}

describe('runHarness artifact validation mid-turn crash rehydration', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-art-val-rehydrate-'))
  })
  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('reconstitutes artifact retry prompt after mid-turn crash on attempt 2', async () => {
    const state = { crashed: false, prompt: '' }
    const runId = 'art-rehydrate-run'
    const harness = {
      name: 'crash-rehydrate-harness',
      steps: [
        {
          id: 'spec-step',
          run: createRehydrationAgent(state),
          artifacts: {
            'spec.md': { nonEmpty: true },
          },
        },
      ],
    }

    const run1 = await runHarness(harness, { workspaceDir: tempDir, runId })
    expect(run1.status).toBe('failed')

    const runDir = resolveRunDir(tempDir, runId)
    releaseRunPidLock(runDir)

    const run2 = await runHarness(harness, { workspaceDir: tempDir, runId })
    expect(run2.status).toBe('passed')
    expect(state.prompt).toContain('The step artifacts failed validation:')
    expect(state.prompt).toContain('spec.md')
  })
})
