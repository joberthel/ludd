import type { LedgerEvent } from '../../types/ledger.js'
import fs from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { runHarness } from '../run-harness.js'

let tempDir: string

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-ledger-events-test-'))
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

function readLedger(workspaceDir: string, runId: string): LedgerEvent[] {
  const filePath = path.join(workspaceDir, '.harness', 'runs', runId, 'ledger.jsonl')
  return fs.readFileSync(filePath, 'utf8')
    .trim()
    .split('\n')
    .map(line => JSON.parse(line) as LedgerEvent)
}

describe('runHarness ledger event schema envelope (AC 2.2.1)', () => {
  it('conforms to LedgerEvent envelope schema across all emitted events', async () => {
    const config = {
      name: 'envelope-schema-harness',
      steps: [
        {
          id: 'step-a',
          run: async () => ({ value: 123 }),
        },
        {
          id: 'step-b',
          if: () => false,
          run: async () => 'skipped',
        },
      ],
    }

    const result = await runHarness(config, { runId: 'run-env-1', workspaceDir: tempDir })
    expect(result.status).toBe('passed')

    const events = readLedger(tempDir, 'run-env-1')
    expect(events.length).toBe(5)
    for (const event of events) {
      expect(event.schemaVersion).toBe(1)
      expect(typeof event.timestamp).toBe('string')
      expect(new Date(event.timestamp).toISOString()).toBe(event.timestamp)
      expect(event.runId).toBe('run-env-1')
      expect(typeof event.eventType).toBe('string')
      expect(typeof event.payload).toBe('object')
      expect(event.payload).not.toBeNull()
      if (event.stepId !== null) {
        expect(typeof event.stepId).toBe('string')
      }
    }
  })
})

describe('runHarness 2-step skipped lifecycle sequence (AC 2.2.2)', () => {
  it('emits run.started -> step.started -> step.passed -> step.skipped -> run.passed', async () => {
    const config = {
      name: 'skip-workflow',
      steps: [
        {
          id: 'step-1',
          run: async () => 'ok-1',
        },
        {
          id: 'step-2',
          if: () => false,
          run: async () => 'unreached',
        },
      ],
    }

    const result = await runHarness(config, { runId: 'run-seq-2', workspaceDir: tempDir })
    expect(result.status).toBe('passed')

    const events = readLedger(tempDir, 'run-seq-2')
    expect(events.map(e => ({ type: e.eventType, stepId: e.stepId }))).toEqual([
      { type: 'run.started', stepId: null },
      { type: 'step.started', stepId: 'step-1' },
      { type: 'step.passed', stepId: 'step-1' },
      { type: 'step.skipped', stepId: 'step-2' },
      { type: 'run.passed', stepId: null },
    ])
    expect(events[0].payload).toEqual({ harnessName: 'skip-workflow' })
    expect(events[1].payload).toEqual({ attempt: 1 })
    expect(events[2].payload).toEqual({ output: 'ok-1' })
    expect(events[3].payload).toEqual({})
    expect(events[4].payload).toEqual({})
  })
})

describe('runHarness failure lifecycle events for runner throws (AC 2.2.3)', () => {
  it('emits step.failed and run.failed when step throws Error', async () => {
    const config = {
      name: 'error-inst',
      steps: [
        {
          id: 's-fail',
          run: async () => { throw new Error('boom') },
        },
      ],
    }
    const result = await runHarness(config, { runId: 'run-fail-err', workspaceDir: tempDir })
    expect(result.status).toBe('failed')

    const events = readLedger(tempDir, 'run-fail-err')
    expect(events.map(e => e.eventType)).toEqual([
      'run.started',
      'step.started',
      'step.failed',
      'run.failed',
    ])
    expect(events[2].payload).toEqual({ error: 'boom' })
    expect(events[3].payload).toEqual({ failedStepId: 's-fail', error: 'boom' })
    expect(events[3].stepId).toBeNull()
  })

  it('emits step.failed and run.failed with String(error) for non-Error rejection', async () => {
    const rejVal = 'string failure'
    const config = {
      name: 'non-err',

      steps: [
        {
          id: 's-rej',
          run: async () => Promise.reject(rejVal),
        },
      ],
    }
    const result = await runHarness(config, { runId: 'run-fail-non-err', workspaceDir: tempDir })
    expect(result.status).toBe('failed')

    const events = readLedger(tempDir, 'run-fail-non-err')
    expect(events[2].payload).toEqual({ error: 'string failure' })
    expect(events[3].payload).toEqual({ failedStepId: 's-rej', error: 'string failure' })
  })
})

describe('runHarness failure lifecycle events for condition and schema errors', () => {
  it('emits step.failed and run.failed without step.started when step.if throws', async () => {
    const config = {
      name: 'if-throw',
      steps: [
        {
          id: 's-if',
          if: () => { throw new Error('if condition error') },
          run: async () => 'never',
        },
      ],
    }
    const result = await runHarness(config, { runId: 'run-if-err', workspaceDir: tempDir })
    expect(result.status).toBe('failed')

    const events = readLedger(tempDir, 'run-if-err')
    expect(events.map(e => e.eventType)).toEqual(['run.started', 'step.failed', 'run.failed'])
    expect(events[1].payload).toEqual({ error: 'if condition error' })
    expect(events[2].payload).toEqual({ failedStepId: 's-if', error: 'if condition error' })
  })

  it('emits step.failed and run.failed when outputSchema fails validation', async () => {
    const config = {
      name: 'schema-err',
      steps: [
        {
          id: 's-schema',
          outputSchema: z.object({
            score: z.number(),
          }),
          run: async () => ({ score: 'invalid' }),
        },
      ],
    }
    const result = await runHarness(config, { runId: 'run-schema-err', workspaceDir: tempDir })
    expect(result.status).toBe('failed')

    const events = readLedger(tempDir, 'run-schema-err')
    expect(events.map(e => e.eventType)).toEqual([
      'run.started',
      'step.started',
      'step.failed',
      'run.failed',
    ])
    expect((events[2].payload as { error: string }).error).toContain('Step "s-schema" output validation failed')
    expect(events[3].payload).toMatchObject({ failedStepId: 's-schema' })
  })
})
