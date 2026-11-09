import type { AgentRunner, AgentTurnInput } from '../../types/agent.js'
import type { StepConfig } from '../../types/harness.js'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readRunState } from '../../persistence/state-store.js'
import { executeMatrixStep } from '../matrix-executor.js'
import { createDummyContext, createDummySnapshot } from './helpers.js'

let tempDir: string

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-matrix-rehydrate-'))
})
afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

describe('executeMatrixStep callback mid-matrix rehydration (AC 4.5.1)', () => {
  it('resumes from startIndex, seeds outputs, and updates state.json before and after each slice', async () => {
    const ctx = createDummyContext()
    const snapshot = createDummySnapshot()
    const executedItems: string[] = []

    const step: StepConfig = {
      id: 'step-resumed',
      matrix: {
        items: ['item-0', 'item-1', 'item-2'],
      },
      run: (c) => {
        const item = c.matrix?.item as string
        executedItems.push(item)
        const onDisk = readRunState(tempDir)
        expect(onDisk.activeMatrixIndex).toBe(c.matrix?.index)
        return `out-${item}`
      },
    }

    const rehydration = {
      matrixIndex: 1,
      matrixOutputs: ['out-item-0'],
    }

    const outputs = await executeMatrixStep(step, step.matrix, ctx, snapshot, tempDir, rehydration)
    expect(outputs).toEqual(['out-item-0', 'out-item-1', 'out-item-2'])
    expect(executedItems).toEqual(['item-1', 'item-2'])

    const finalState = readRunState(tempDir)
    expect(finalState.activeMatrixIndex).toBeNull()
    expect(finalState.activeMatrixOutputs).toEqual(['out-item-0', 'out-item-1', 'out-item-2'])
    expect(finalState.activeSessionId).toBeNull()
    expect(finalState.activeStepAttempt).toBe(1)
  })
})

describe('executeMatrixStep agent mid-matrix rehydration (AC 4.5.2)', () => {
  it('passes rehydration to slice k and resets rehydration for slice k+1 with agent steps', async () => {
    const ctx = createDummyContext()
    const snapshot = createDummySnapshot()
    const capturedInputs: AgentTurnInput[] = []

    const agent: AgentRunner<string> = {
      __kind: 'agent',
      mode: 'read-only',
      prompt: 'process slice',
      executeTurn: async (input) => {
        capturedInputs.push(input)
        return { output: `done-${input.sessionId}`, sessionId: input.sessionId }
      },
    }

    const step: StepConfig = {
      id: 'step-agent-matrix',
      matrix: {
        items: ['slice-0', 'slice-1', 'slice-2'],
      },
      run: agent,
    }

    const rehydration = {
      matrixIndex: 1,
      matrixOutputs: ['done-sess-prior'],
      sessionId: 'sess-rehydrated-k',
      attempt: 3,
    }

    const outputs = await executeMatrixStep(step, step.matrix, ctx, snapshot, tempDir, rehydration)
    expect(outputs).toEqual([
      'done-sess-prior',
      { value: 'done-sess-rehydrated-k', sessionId: 'sess-rehydrated-k' },
      expect.objectContaining({
        value: expect.stringContaining('done-session-'),
      }),
    ])
    expect(capturedInputs).toHaveLength(2)
    expect(capturedInputs[0].sessionId).toBe('sess-rehydrated-k')
    expect(capturedInputs[0].attempt).toBe(3)
    expect(capturedInputs[1].sessionId).not.toBe('sess-rehydrated-k')
    expect(capturedInputs[1].attempt).toBe(1)
  })
})
