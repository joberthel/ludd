import type { ArtifactClient, StepContext } from '../types/context.js'
import type { MatrixConfig, StepConfig } from '../types/harness.js'
import type { RunStateSnapshot } from '../types/state.js'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { StepMatrixResolutionError } from '../errors/step-matrix-resolution-error.js'
import { executeMatrixStep, resolveMatrixItems } from './matrix-executor.js'

function createFakeArtifactClient(artifacts: Record<string, string | null> = {}): ArtifactClient {
  return {
    get: vi.fn(async (key: string) => artifacts[key] ?? null),
    put: vi.fn(async () => {}),
    getJson: async <T>(key: string): Promise<T | null> => {
      const val = artifacts[key]
      if (val === null || val === undefined) {
        return null
      }
      return JSON.parse(val) as T
    },
    has: vi.fn(async (key: string) => artifacts[key] !== undefined && artifacts[key] !== null),
  }
}

function createDummyContext(artifacts: Record<string, string | null> = {}): StepContext {
  return {
    runId: 'r-matrix-test',
    environments: {},
    steps: {},
    step: { id: 'step-matrix', output: undefined, attempt: 1 },
    matrix: undefined,
    artifacts: createFakeArtifactClient(artifacts),
  }
}

function createDummySnapshot(): RunStateSnapshot {
  return {
    schemaVersion: 1,
    runId: 'r-matrix-test',
    harnessName: 'test-harness',
    status: 'running',
    activeStepId: 'step-matrix',
    activeSessionId: null,
    activeStepAttempt: 1,
    steps: {},
    updatedAt: new Date().toISOString(),
  }
}

describe('resolveMatrixItems static and dynamic items', () => {
  it('resolves static array items', async () => {
    const ctx = createDummyContext()
    const config: MatrixConfig = {
      items: ['item-1', 'item-2'],
    }
    const result = await resolveMatrixItems('step-1', config, ctx)
    expect(result).toEqual(['item-1', 'item-2'])
  })

  it('resolves dynamic function returning array items', async () => {
    const ctx = createDummyContext()
    const config: MatrixConfig = {
      items: c => [`run-${c.runId}-a`, `run-${c.runId}-b`],
    }
    const result = await resolveMatrixItems('step-1', config, ctx)
    expect(result).toEqual(['run-r-matrix-test-a', 'run-r-matrix-test-b'])
  })

  it('throws StepMatrixResolutionError when dynamic items resolve to non-array or empty array', async () => {
    const ctx = createDummyContext()
    const emptyConfig: MatrixConfig = {
      items: () => [],
    }
    await expect(resolveMatrixItems('step-1', emptyConfig, ctx)).rejects.toThrow(
      StepMatrixResolutionError,
    )
    await expect(resolveMatrixItems('step-1', emptyConfig, ctx)).rejects.toThrow(
      'Step "step-1" matrix resolution failed: Matrix "items" must resolve to a non-empty array.',
    )

    const nonArrayConfig: MatrixConfig = {
      items: () => null as unknown as unknown[],
    }
    await expect(resolveMatrixItems('step-1', nonArrayConfig, ctx)).rejects.toThrow(
      'Step "step-1" matrix resolution failed: Matrix "items" must resolve to a non-empty array.',
    )
  })
})

describe('resolveMatrixItems artifact resolution', () => {
  it('resolves items from valid JSON artifact array', async () => {
    const ctx = createDummyContext({
      'todos.json': JSON.stringify([
        { id: 1, title: 'First' },
        { id: 2, title: 'Second' },
      ]),
    })
    const config: MatrixConfig = { itemsFromArtifact: 'todos.json' }
    const result = await resolveMatrixItems('step-art', config, ctx)
    expect(result).toEqual([
      { id: 1, title: 'First' },
      { id: 2, title: 'Second' },
    ])
  })

  it('throws StepMatrixResolutionError when artifact is missing', async () => {
    const ctx = createDummyContext()
    const config: MatrixConfig = { itemsFromArtifact: 'missing.json' }
    await expect(resolveMatrixItems('step-art', config, ctx)).rejects.toThrow(
      'Step "step-art" matrix resolution failed: Artifact "missing.json" not found.',
    )
  })

  it('throws StepMatrixResolutionError when artifact has invalid JSON', async () => {
    const ctx = createDummyContext({ 'bad.json': '{ invalid-json' })
    const config: MatrixConfig = { itemsFromArtifact: 'bad.json' }
    await expect(resolveMatrixItems('step-art', config, ctx)).rejects.toThrow(
      'Step "step-art" matrix resolution failed: Artifact "bad.json" does not contain valid JSON.',
    )
  })

  it('throws StepMatrixResolutionError when artifact does not contain a non-empty array', async () => {
    const ctxObject = createDummyContext({
      'object.json': JSON.stringify({ key: 'value' }),
    })
    await expect(resolveMatrixItems('step-art', { itemsFromArtifact: 'object.json' }, ctxObject)).rejects.toThrow(
      'Step "step-art" matrix resolution failed: Artifact "object.json" must contain a non-empty JSON array.',
    )

    const ctxEmpty = createDummyContext({
      'empty.json': JSON.stringify([]),
    })
    await expect(resolveMatrixItems('step-art', { itemsFromArtifact: 'empty.json' }, ctxEmpty)).rejects.toThrow(
      'Step "step-art" matrix resolution failed: Artifact "empty.json" must contain a non-empty JSON array.',
    )
  })
})

describe('executeMatrixStep sequential execution', () => {
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
      '/fake/dir',
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

describe('executeMatrixStep error handling', () => {
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
      executeMatrixStep(step, step.matrix, ctx, createDummySnapshot(), '/fake/dir'),
    ).rejects.toThrow('Slice 1 blew up')
  })

  it('throws StepMatrixResolutionError if matrix configuration is missing', async () => {
    const ctx = createDummyContext()
    const step: StepConfig = {
      id: 'step-no-matrix',
      run: () => 'ok',
    }

    await expect(
      executeMatrixStep(step, undefined, ctx, createDummySnapshot(), '/fake/dir'),
    ).rejects.toThrow('Step "step-no-matrix" matrix resolution failed: Matrix configuration is required.')
  })
})
