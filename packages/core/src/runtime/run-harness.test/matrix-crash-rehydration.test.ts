import type { AgentRunner, AgentTurnInput } from '../../types/agent.js'
import type { HarnessConfig, StepConfig } from '../../types/harness.js'
import fs from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { releaseRunPidLock } from '../../persistence/pid-lock.js'
import { readRunState, resolveRunDir } from '../../persistence/state-store.js'
import { runHarness } from '../run-harness.js'

let tempDir: string

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-matrix-crash-'))
})
afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

function writeCrashState(runDir: string, overrides: Record<string, unknown>): void {
  const state = readRunState(runDir)
  const updated = {
    ...state,
    ...overrides,
  }
  fs.writeFileSync(path.join(runDir, 'state.json'), `${JSON.stringify(updated, null, 2)}\n`, 'utf-8')
}

function createCrashingAgent(
  turns: AgentTurnInput[],
  onFirstSession: (id: string) => void,
): AgentRunner<string> {
  let hasCrashed = false
  return {
    __kind: 'agent',
    mode: 'read-only',
    prompt: 'work on slice',
    executeTurn: async (input) => {
      turns.push({
        ...input,
      })
      if (input.attempt === 1 && !hasCrashed) {
        hasCrashed = true
        onFirstSession(input.sessionId)
        throw new Error('crash during slice turn')
      }
      return {
        output: `finished-${input.sessionId}`,
        sessionId: input.sessionId,
      }
    },
  }
}

describe('runHarness mid-matrix slice resume (AC 4.5.1)', () => {
  it('resumes from slice k without re-executing slices 0..k-1 and preserves activeMatrixOutputs', async () => {
    let hasCrashed = false
    const sliceInvocations: string[] = []

    const step: StepConfig = {
      id: 'step-work',
      matrix: {
        items: [
          'task-a',
          'task-b',
          'task-c',
        ],
      },
      run: (c) => {
        const item = c.matrix?.item as string
        sliceInvocations.push(item)
        if (item === 'task-b' && !hasCrashed) {
          hasCrashed = true
          throw new Error('simulated mid-matrix crash on task-b')
        }
        return `done-${item}`
      },
    }

    const runId = 'mid-matrix-resume-run'
    const harness: HarnessConfig = {
      name: 'matrix-resume-test',
      steps: [
        step,
      ],
    }

    const run1 = await runHarness(harness, { workspaceDir: tempDir, runId })
    expect(run1.status).toBe('failed')
    expect(sliceInvocations).toEqual(['task-a', 'task-b'])

    const runDir = resolveRunDir(tempDir, runId)
    releaseRunPidLock(runDir)

    const intermediateState = readRunState(runDir)
    expect(intermediateState.activeMatrixIndex).toBe(1)
    expect(intermediateState.activeMatrixOutputs).toEqual(['done-task-a'])

    const run2 = await runHarness(harness, { workspaceDir: tempDir, runId })
    expect(run2.status).toBe('passed')
    expect(sliceInvocations).toEqual(['task-a', 'task-b', 'task-b', 'task-c'])
    expect(run2.steps['step-work'].output).toEqual(['done-task-a', 'done-task-b', 'done-task-c'])

    const finalState = readRunState(runDir)
    expect(finalState.activeMatrixIndex).toBeNull()
    expect(finalState.activeMatrixOutputs).toEqual([])
  })
})

describe('runHarness matrix active state cleanup (AC 4.5.3)', () => {
  it('resets activeMatrixIndex and activeMatrixOutputs when matrix step completes', async () => {
    const harness: HarnessConfig = {
      name: 'matrix-reset-test',
      steps: [
        {
          id: 'step-m',
          matrix: {
            items: [
              1,
              2,
            ],
          },
          run: c => Number(c.matrix?.item) * 10,
        },
        {
          id: 'step-after',
          run: (c) => {
            const onDisk = readRunState(resolveRunDir(tempDir, c.runId))
            expect(onDisk.activeMatrixIndex).toBeNull()
            expect(onDisk.activeMatrixOutputs).toEqual([])
            return 'ok'
          },
        },
      ],
    }

    const run = await runHarness(harness, { workspaceDir: tempDir, runId: 'matrix-reset-run' })
    expect(run.status).toBe('passed')

    const finalState = readRunState(resolveRunDir(tempDir, 'matrix-reset-run'))
    expect(finalState.activeMatrixIndex).toBeNull()
    expect(finalState.activeMatrixOutputs).toEqual([])
  })
})

describe('runHarness agent matrix slice rehydration (AC 4.5.2)', () => {
  it('rehydrates activeSessionId and attempt on slice k, while slice k+1 starts fresh at attempt 1', async () => {
    const turnsRecorded: AgentTurnInput[] = []
    let slice1Session: string | undefined
    const agent = createCrashingAgent(turnsRecorded, id => (slice1Session = id))

    const runId = 'agent-matrix-crash-run'
    const harness: HarnessConfig = {
      name: 'agent-matrix-crash-test',
      steps: [
        {
          id: 'step-slices',
          matrix: {
            items: [
              'slice-1',
              'slice-2',
            ],
          },
          run: agent,
        },
      ],
    }

    const run1 = await runHarness(harness, { workspaceDir: tempDir, runId })
    expect(run1.status).toBe('failed')
    const runDir = resolveRunDir(tempDir, runId)
    releaseRunPidLock(runDir)

    const midCrashState = readRunState(runDir)
    expect(midCrashState.activeMatrixIndex).toBe(0)
    expect(midCrashState.activeSessionId).toBe(slice1Session)

    writeCrashState(runDir, { activeStepAttempt: 2 })

    const run2 = await runHarness(harness, { workspaceDir: tempDir, runId })
    expect(run2.status).toBe('passed')
    expect(turnsRecorded[1].sessionId).toBe(slice1Session)
    expect(turnsRecorded[1].attempt).toBe(2)
    expect(turnsRecorded[2].sessionId).not.toBe(slice1Session)
    expect(turnsRecorded[2].attempt).toBe(1)
  })
})
