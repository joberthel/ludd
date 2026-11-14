import type { StepConfig } from '../../types/harness.js'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { executeMatrixStep, executeSingleSlice } from '../matrix-executor.js'
import { createDummyContext, createDummySnapshot } from './helpers.js'

describe('executeMatrixStep sequential execution', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-matrix-exec-'))
  })
  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('iterates sequentially, updates ctx.matrix, and returns aggregated outputs', async () => {
    const ctx = createDummyContext()
    const capturedCursors: Array<{ index: number, total: number, item: unknown }> = []

    const step: StepConfig = {
      id: 'step-seq',
      matrix: {
        items: [10, 20, 30],
      },
      outputSchema: z.number(),
      run: (c) => {
        if (c.matrix) {
          capturedCursors.push({ ...c.matrix })
          return (c.matrix.item as number) * 2
        }
        return 0
      },
    }

    const outputs = await executeMatrixStep(
      step,
      step.matrix,
      ctx,
      createDummySnapshot(),
      tempDir,
    )

    expect(outputs).toEqual([20, 40, 60])
    expect(capturedCursors).toEqual([
      { index: 0, total: 3, item: 10 },
      { index: 1, total: 3, item: 20 },
      { index: 2, total: 3, item: 30 },
    ])
    expect(ctx.matrix).toBeUndefined()
  })
})

describe('executeSingleSlice after-step gate recovery', () => {
  it('restores beforeStep results before running resumed afterStep guardrails', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-slice-resume-'))
    try {
      const ctx = createDummyContext()
      const snapshot = createDummySnapshot()
      snapshot.activeBeforeStepResults = { answer: 'saved' }
      let seen: unknown
      const step: StepConfig = {
        id: 'step-resume',
        run: () => { throw new Error('The run callback must not rerun after an afterStep gate') },
        afterStep: [
          {
            __kind: 'guardrail',
            type: 'fn',
            execute: async ({ ctx: gateCtx }) => {
              seen = (gateCtx).beforeStep.answer
              return { status: 'pass' }
            },
          },
        ],
      }
      await executeSingleSlice(
        step,
        ctx,
        snapshot,
        tempDir,
        {
          activeGate: {
            stepId: 'step-resume',
            phase: 'afterStep',
            guardrailIndex: 0,
            gateType: 'human_review',
            prompt: 'resume',
            createdAt: new Date().toISOString(),
          },
          activeStepOutput: { completed: true },
        },
      )
      expect(seen).toBe('saved')
    }
    finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it('restores beforeStep results on attempt > 1 rehydration without rerunning beforeStep', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-slice-retry-'))
    try {
      const ctx = createDummyContext()
      const snapshot = createDummySnapshot()
      snapshot.activeBeforeStepResults = { answer: 'saved' }
      let seen: unknown
      const step: StepConfig = {
        id: 'step-retry',
        beforeStep: () => {
          throw new Error('beforeStep must not rerun on attempt > 1')
        },
        run: (runCtx) => {
          seen = (runCtx as typeof runCtx & { beforeStep: { answer: string } }).beforeStep.answer
          return { ok: true }
        },
      }
      await executeSingleSlice(
        step,
        ctx,
        snapshot,
        tempDir,
        { attempt: 2 },
      )
      expect(seen).toBe('saved')
    }
    finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })
})

describe('executeMatrixStep error handling', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-matrix-err-'))
  })
  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('bubbles error if slice fails', async () => {
    const ctx = createDummyContext()
    const step: StepConfig = {
      id: 'step-fail',
      matrix: {
        items: ['pass', 'fail', 'unreachable'],
      },
      run: (c) => {
        if (c.matrix?.index === 1) {
          throw new Error('Slice 1 blew up')
        }
        return 'ok'
      },
    }

    await expect(
      executeMatrixStep(step, step.matrix, ctx, createDummySnapshot(), tempDir),
    ).rejects.toThrow('Slice 1 blew up')
  })

  it('throws StepMatrixResolutionError if matrix configuration is missing', async () => {
    const ctx = createDummyContext()
    const step: StepConfig = {
      id: 'step-no-matrix',
      run: () => 'ok',
    }

    await expect(
      executeMatrixStep(step, undefined, ctx, createDummySnapshot(), tempDir),
    ).rejects.toThrow('Step "step-no-matrix" matrix resolution failed: Matrix configuration is required.')
  })
})
