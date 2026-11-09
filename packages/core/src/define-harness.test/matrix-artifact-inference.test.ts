import type { MatrixCursor } from '../types/context.js'
import type { AccumulateArtifactItemMap, AccumulatePriorSteps, InferMatrixItem } from '../types/harness.js'
import { describe, expect, expectTypeOf, it } from 'vitest'
import { z } from 'zod'
import { mockAgent } from '../../../agents/src/mock-agent.js'
import { defineHarness } from '../define-harness.js'

const TodoSliceSchema = z.object({
  id: z.string(),
  title: z.string(),
})
type TodoSlice = z.infer<typeof TodoSliceSchema>

const todosArtifact = {
  'todos.json': {
    schema: z.array(TodoSliceSchema).min(1),
  },
}
const commitSchema = z.object({
  commitMessage: z.string(),
})
const triageSchema = z.object({
  status: z.enum(['needs_clarification', 'ready']),
  questions: z.array(z.string()),
  summary: z.string(),
})

type TriageOutput = (z.infer<typeof triageSchema> & { sessionId: string }) | undefined
type ImplementOutput = Array<z.infer<typeof commitSchema> & { sessionId: string }> | undefined

const triageResponses = [
  {
    output: { status: 'ready' as const, questions: [] as string[], summary: 'Feature summary' },
  },
]
const sliceResponses = [
  {
    output: { commitMessage: 'feat: slice' },
  },
]

describe('itemsFromArtifact agent matrix (AC 4.4.1 & AC 4.4.4)', () => {
  it('infers itemsFromArtifact matrix with mockAgent & downstream ctx.steps output', () => {
    const harness = defineHarness({
      name: 'artifact-matrix-pipeline',
      steps: [
        {
          id: 'plan-slices',
          artifacts: todosArtifact,
          run: () => ({ count: 3 }),
        },
        {
          id: 'implement-slices',
          matrix: { itemsFromArtifact: 'todos.json' },
          outputSchema: commitSchema,
          run: mockAgent({
            prompt: (ctx) => {
              expectTypeOf(ctx.matrix).toEqualTypeOf<MatrixCursor<TodoSlice>>()
              return `Implement: ${ctx.matrix.item.title}`
            },
            responses: sliceResponses,
          }),
        },
        {
          id: 'verify-results',
          run: (ctx) => {
            expectTypeOf(ctx.steps['implement-slices'].output).toEqualTypeOf<ImplementOutput>()
            return { verified: true }
          },
        },
      ],
    })

    expect(harness.steps).toHaveLength(3)
  })
})

describe('itemsFromArtifact callback matrix (AC 4.4.1)', () => {
  it('infers non-nullable ctx.matrix and item schema in itemsFromArtifact callback step', () => {
    const harness = defineHarness({
      name: 'artifact-matrix-callback-pipeline',
      steps: [
        {
          id: 'plan-slices',
          artifacts: todosArtifact,
          run: () => ({ count: 3 }),
        },
        {
          id: 'process-slice',
          matrix: { itemsFromArtifact: 'todos.json' },
          run: (ctx) => {
            expectTypeOf(ctx.matrix).toEqualTypeOf<MatrixCursor<TodoSlice>>()
            return { sliceId: ctx.matrix.item.id }
          },
        },
      ],
    })

    expect(harness.steps).toHaveLength(2)
  })
})

describe('static matrix items (AC 4.4.2)', () => {
  it('infers non-nullable ctx.matrix and item element type in static array matrix step', () => {
    const harness = defineHarness({
      name: 'static-matrix-pipeline',
      steps: [
        {
          id: 'process-tasks',
          matrix: {
            items: ['task-1', 'task-2'],
          },
          run: (ctx) => {
            expectTypeOf(ctx.matrix).toEqualTypeOf<MatrixCursor<string>>()
            return { done: ctx.matrix.item }
          },
        },
      ],
    })

    expect(harness.steps).toHaveLength(1)
  })
})

describe('dynamic matrix items (AC 4.4.2)', () => {
  it('infers non-nullable ctx.matrix in dynamic (ctx) => [...] callback matrix step', () => {
    const harness = defineHarness({
      name: 'dynamic-matrix-pipeline',
      steps: [
        {
          id: 'process-dynamic',
          matrix: {
            items: () => [10, 20],
          },
          run: (ctx) => {
            expectTypeOf(ctx.matrix).toEqualTypeOf<MatrixCursor<number>>()
            return { processed: ctx.matrix.item }
          },
        },
      ],
    })

    expect(harness.steps).toHaveLength(1)
  })
})

describe('non-matrix step compile-time inference (AC 4.4.3)', () => {
  it('types ctx.matrix as MatrixCursor<unknown> | undefined in non-matrix steps', () => {
    const harness = defineHarness({
      name: 'non-matrix-pipeline',
      steps: [
        {
          id: 'step-callback',
          run: (ctx) => {
            expectTypeOf(ctx.matrix).toEqualTypeOf<MatrixCursor<unknown> | undefined>()
            return { ok: true }
          },
        },
        {
          id: 'step-agent',
          run: mockAgent({
            prompt: (ctx) => {
              expectTypeOf(ctx.matrix).toEqualTypeOf<MatrixCursor<unknown> | undefined>()
              return 'test'
            },
            responses: sliceResponses,
          }),
        },
      ],
    })

    expect(harness.steps).toHaveLength(2)
  })
})

describe('4-step pipeline matching TDD Section 9.2 (Issue #25 readiness)', () => {
  it('infers types across all 4 steps with inline mockAgent and matrix artifacts', () => {
    const harness = defineHarness({
      name: 'interactive-feature-workflow',
      steps: [
        {
          id: 'triage-and-grilling',
          outputSchema: triageSchema,
          run: mockAgent({ prompt: 'Analyze feature request', responses: triageResponses }),
        },
        {
          id: 'generate-spec-and-todos',
          artifacts: todosArtifact,
          run: (ctx) => {
            expectTypeOf(ctx.steps['triage-and-grilling'].output).toEqualTypeOf<TriageOutput>()
            return { generated: true }
          },
        },
        {
          id: 'implement-slices',
          matrix: { itemsFromArtifact: 'todos.json' },
          outputSchema: commitSchema,
          run: mockAgent({
            prompt: (ctx) => {
              expectTypeOf(ctx.matrix).toEqualTypeOf<MatrixCursor<TodoSlice>>()
              return `Implement slice: ${ctx.matrix.item.title}`
            },
            responses: sliceResponses,
          }),
        },
        {
          id: 'final-review-and-pr',
          if: ctx => ctx.steps['implement-slices'].status === 'passed',
          run: (ctx) => {
            expectTypeOf(ctx.steps['implement-slices'].output).toEqualTypeOf<ImplementOutput>()
            return { prCreated: true }
          },
        },
      ],
    })

    expect(harness.steps).toHaveLength(4)
  })
})

describe('standalone type helpers (AccumulateArtifactItemMap, InferMatrixItem)', () => {
  it('accumulates artifact schemas and infers matrix items', () => {
    interface Step0 {
      id: 'step0'
      artifacts: typeof todosArtifact
      run: () => void
    }
    type ArtMap = AccumulateArtifactItemMap<[Step0]>
    expectTypeOf<ArtMap['todos.json']>().toEqualTypeOf<TodoSlice>()

    expectTypeOf<InferMatrixItem<{ matrix: { itemsFromArtifact: 'todos.json' } }, ArtMap>>().toEqualTypeOf<TodoSlice>()
    expectTypeOf<InferMatrixItem<{ matrix: { items: readonly number[] } }, ArtMap>>().toEqualTypeOf<number>()
    expectTypeOf<InferMatrixItem<{ id: 'plain' }, ArtMap>>().toEqualTypeOf<unknown>()

    type PriorSteps = AccumulatePriorSteps<[Step0]>
    expectTypeOf<PriorSteps['step0']['status']>().toEqualTypeOf<'passed' | 'failed' | 'skipped'>()
  })
})
