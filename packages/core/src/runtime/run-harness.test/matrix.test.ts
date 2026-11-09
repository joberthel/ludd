import type { AgentRunner } from '../../types/agent.js'
import type { HarnessConfig } from '../../types/harness.js'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { StepMatrixResolutionError } from '../../errors/step-matrix-resolution-error.js'
import { readLedgerEvents } from '../../persistence/ledger-writer.js'
import { runHarness } from '../run-harness.js'

let workspaceDir: string

beforeEach(async () => {
  workspaceDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-matrix-test-'))
})

afterEach(async () => {
  await rm(workspaceDir, { recursive: true, force: true })
})

describe('runHarness matrix static items', () => {
  it('executes static items, aggregates outputs, and resets ctx.matrix for subsequent steps', async () => {
    let capturedInStep2Matrix: unknown = 'unvisited'
    let step2SeenOutputs: unknown

    const config: HarnessConfig = {
      name: 'static-matrix-harness',
      steps: [
        {
          id: 'step-matrix',
          matrix: {
            items: ['slice-1', 'slice-2', 'slice-3'],
          },
          outputSchema: z.string(),
          run: ctx => `result-${ctx.matrix?.index}-${String(ctx.matrix?.item)}`,
        },
        {
          id: 'step-subsequent',
          run: (ctx) => {
            capturedInStep2Matrix = ctx.matrix
            step2SeenOutputs = ctx.steps['step-matrix']?.output
            return 'done'
          },
        },
      ],
    }

    const res = await runHarness(config, { workspaceDir })
    expect(res.status).toBe('passed')
    expect(res.steps['step-matrix'].output).toEqual([
      'result-0-slice-1',
      'result-1-slice-2',
      'result-2-slice-3',
    ])
    expect(capturedInStep2Matrix).toBeUndefined()
    expect(step2SeenOutputs).toEqual([
      'result-0-slice-1',
      'result-1-slice-2',
      'result-2-slice-3',
    ])
  })
})

describe('runHarness matrix dynamic and artifact items', () => {
  it('resolves dynamic items callback with StepContext', async () => {
    const config: HarnessConfig = {
      name: 'dynamic-matrix-harness',
      steps: [
        {
          id: 'step-dynamic',
          matrix: {
            items: ctx => [10, 20].map(n => n + ctx.runId.length),
          },
          run: ctx => (ctx.matrix?.item as number) * 2,
        },
      ],
    }

    const res = await runHarness(config, { workspaceDir, runId: 'fixed-run-id' })
    expect(res.status).toBe('passed')
    const offset = 'fixed-run-id'.length
    expect(res.steps['step-dynamic'].output).toEqual([(10 + offset) * 2, (20 + offset) * 2])
  })

  it('resolves matrix items from artifact written by prior step', async () => {
    const config: HarnessConfig = {
      name: 'artifact-matrix-harness',
      steps: [
        {
          id: 'step-producer',
          run: async (ctx) => {
            await ctx.artifacts.put('todos.json', JSON.stringify(['task-a', 'task-b']))
            return 'written'
          },
        },
        {
          id: 'step-consumer',
          matrix: { itemsFromArtifact: 'todos.json' },
          run: ctx => `processed:${String(ctx.matrix?.item)}`,
        },
      ],
    }

    const res = await runHarness(config, { workspaceDir })
    expect(res.status).toBe('passed')
    expect(res.steps['step-consumer'].output).toEqual(['processed:task-a', 'processed:task-b'])
  })
})

describe('runHarness matrix agent runner & ledger matrixIndex', () => {
  it('uses ctx.matrix in agent prompt & sessionId, recording matrixIndex on ledger events', async () => {
    const capturedPrompts: string[] = []
    const capturedSessions: string[] = []

    const agent: AgentRunner<string> = {
      __kind: 'agent',
      mode: 'read-only',
      prompt: ctx => `prompt for item: ${String(ctx.matrix?.item)}`,
      sessionId: ctx => `agent-sess-slice-${String(ctx.matrix?.index)}`,
      executeTurn: async (input) => {
        capturedPrompts.push(input.prompt)
        capturedSessions.push(input.sessionId)
        return { output: `done-${input.sessionId}`, sessionId: input.sessionId }
      },
    }

    const config: HarnessConfig = {
      name: 'agent-matrix-harness',
      steps: [
        {
          id: 'step-agent-matrix',
          matrix: {
            items: ['apple', 'banana'],
          },
          run: agent,
        },
      ],
    }

    const res = await runHarness(config, { workspaceDir, runId: 'r-agent-matrix' })
    expect(res.status).toBe('passed')
    expect(capturedPrompts).toEqual(['prompt for item: apple', 'prompt for item: banana'])
    expect(capturedSessions).toEqual(['agent-sess-slice-0', 'agent-sess-slice-1'])

    const runDir = path.join(workspaceDir, '.harness', 'runs', 'r-agent-matrix')
    const events = readLedgerEvents(runDir)
    const streamEvents = events.filter(e => e.eventType === 'agent.stream.linked')
    expect(streamEvents).toHaveLength(2)
    expect(streamEvents[0].matrixIndex).toBe(0)
    expect(streamEvents[1].matrixIndex).toBe(1)
  })
})

describe('runHarness matrix slice failure', () => {
  it('records matrixIndex on step.failed ledger event when matrix slice fails', async () => {
    const config: HarnessConfig = {
      name: 'failing-slice-harness',
      steps: [
        {
          id: 'step-fail',
          matrix: {
            items: ['first', 'bad-slice'],
          },
          run: (ctx) => {
            if (ctx.matrix?.index === 1) {
              throw new Error('Slice 1 execution failed')
            }
            return 'ok'
          },
        },
      ],
    }

    const res = await runHarness(config, { workspaceDir, runId: 'r-slice-fail' })
    expect(res.status).toBe('failed')
    expect(res.failedStepId).toBe('step-fail')

    const runDir = path.join(workspaceDir, '.harness', 'runs', 'r-slice-fail')
    const events = readLedgerEvents(runDir)
    const failedEvent = events.find(e => e.eventType === 'step.failed')
    expect(failedEvent).toBeDefined()
    expect(failedEvent?.matrixIndex).toBe(1)
    expect(failedEvent?.payload).toEqual({ error: 'Slice 1 execution failed' })
  })
})

describe('runHarness matrix missing artifact error', () => {
  it('fails harness with StepMatrixResolutionError on missing artifact', async () => {
    const config: HarnessConfig = {
      name: 'missing-art-harness',
      steps: [
        {
          id: 'step-missing',
          matrix: { itemsFromArtifact: 'non-existent.json' },
          run: () => 'ok',
        },
      ],
    }

    const res = await runHarness(config, { workspaceDir })
    expect(res.status).toBe('failed')
    expect(res.error).toBeInstanceOf(StepMatrixResolutionError)
    expect((res.error as Error).message).toContain('Artifact "non-existent.json" not found.')
  })
})

describe('runHarness matrix invalid content errors', () => {
  it('fails harness with StepMatrixResolutionError on invalid JSON or non-array dynamic items', async () => {
    const configBadJson: HarnessConfig = {
      name: 'bad-json-harness',
      steps: [
        {
          id: 'step-init',
          run: async ctx => ctx.artifacts.put('broken.json', 'not-valid-json{'),
        },
        {
          id: 'step-matrix',
          matrix: { itemsFromArtifact: 'broken.json' },
          run: () => 'ok',
        },
      ],
    }
    const resBadJson = await runHarness(configBadJson, { workspaceDir })
    expect(resBadJson.status).toBe('failed')
    expect(resBadJson.error).toBeInstanceOf(StepMatrixResolutionError)
    expect((resBadJson.error as Error).message).toContain('does not contain valid JSON.')

    const configEmptyDyn: HarnessConfig = {
      name: 'empty-dyn-harness',
      steps: [
        {
          id: 'step-empty',
          matrix: {
            items: () => [],
          },
          run: () => 'ok',
        },
      ],
    }
    const resEmpty = await runHarness(configEmptyDyn, { workspaceDir })
    expect(resEmpty.status).toBe('failed')
    expect(resEmpty.error).toBeInstanceOf(StepMatrixResolutionError)
    expect((resEmpty.error as Error).message).toContain('Matrix "items" must resolve to a non-empty array.')
  })
})
