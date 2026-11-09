import type { MatrixConfig } from '../../types/harness.js'
import { describe, expect, it } from 'vitest'
import { StepMatrixResolutionError } from '../../errors/step-matrix-resolution-error.js'
import { resolveMatrixItems } from '../matrix-executor.js'
import { createDummyContext } from './helpers.js'

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
