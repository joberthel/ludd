import type { RunStateSnapshot } from '../../types/state.js'
import fs from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { runHarness } from '../run-harness.js'

let tempDir: string

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-persist-test-'))
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

function readState(workspaceDir: string, runId: string): RunStateSnapshot {
  const file = path.join(workspaceDir, '.harness', 'runs', runId, 'state.json')
  return JSON.parse(fs.readFileSync(file, 'utf-8')) as RunStateSnapshot
}

function hasTmp(workspaceDir: string, runId: string): boolean {
  const file = path.join(workspaceDir, '.harness', 'runs', runId, 'state.json.tmp')
  return fs.existsSync(file)
}

describe('runHarness state persistence snapshots', () => {
  it('creates state.json snapshot with schemaVersion 1 and passed status (AC 2.1.1)', async () => {
    const config = {
      name: 'persistence-harness',
      steps: [
        {
          id: 's1',
          run: async () => ({ value: 42 }),
        },
        {
          id: 's2',
          run: async () => 'done',
        },
      ],
    }

    const result = await runHarness(config, { runId: 'run-1', workspaceDir: tempDir })
    expect(result.status).toBe('passed')

    const state = readState(tempDir, 'run-1')
    expect(state.schemaVersion).toBe(1)
    expect(state.runId).toBe('run-1')
    expect(state.harnessName).toBe('persistence-harness')
    expect(state.status).toBe('passed')
    expect(state.activeStepId).toBeNull()
    expect(new Date(state.updatedAt).toISOString()).toBe(state.updatedAt)
    expect(state.steps).toEqual({
      s1: {
        status: 'passed',
        output: { value: 42 },
      },
      s2: {
        status: 'passed',
        output: 'done',
      },
    })
    expect(hasTmp(tempDir, 'run-1')).toBe(false)
  })
})

describe('runHarness intermediate state observability', () => {
  it('updates state.json on intermediate transitions without tmp leftovers (AC 2.1.2)', async () => {
    let step1Observed: RunStateSnapshot | undefined
    let step2Observed: RunStateSnapshot | undefined

    const config = {
      name: 'observable-transitions',
      steps: [
        {
          id: 'step-1',
          run: async () => {
            expect(hasTmp(tempDir, 'run-obs')).toBe(false)
            step1Observed = readState(tempDir, 'run-obs')
            return 'step-1-out'
          },
        },
        {
          id: 'step-2',
          run: async () => {
            expect(hasTmp(tempDir, 'run-obs')).toBe(false)
            step2Observed = readState(tempDir, 'run-obs')
            return 'step-2-out'
          },
        },
      ],
    }

    await runHarness(config, { runId: 'run-obs', workspaceDir: tempDir })

    expect(step1Observed?.status).toBe('running')
    expect(step1Observed?.activeStepId).toBe('step-1')
    expect(step1Observed?.steps).toEqual({})

    expect(step2Observed?.status).toBe('running')
    expect(step2Observed?.activeStepId).toBe('step-2')
    expect(step2Observed?.steps).toEqual({
      'step-1': { status: 'passed', output: 'step-1-out' },
    })

    const finalState = readState(tempDir, 'run-obs')
    expect(finalState.status).toBe('passed')
    expect(finalState.activeStepId).toBeNull()
    expect(hasTmp(tempDir, 'run-obs')).toBe(false)
  })
})

describe('runHarness failure state persistence for runner throws', () => {
  it('updates state.json to failed when step run throws (AC 2.1.3)', async () => {
    const config = {
      name: 'failure-run-throw',
      steps: [
        {
          id: 's1',
          run: async () => 'ok',
        },
        {
          id: 's2',
          run: async () => {
            throw new Error('boom')
          },
        },
        {
          id: 's3',
          run: async () => 'unreached',
        },
      ],
    }

    const result = await runHarness(config, { runId: 'run-fail-1', workspaceDir: tempDir })
    expect(result.status).toBe('failed')

    const state = readState(tempDir, 'run-fail-1')
    expect(state.schemaVersion).toBe(1)
    expect(state.status).toBe('failed')
    expect(state.activeStepId).toBeNull()
    expect(state.steps.s1).toEqual({ status: 'passed', output: 'ok' })
    expect(state.steps.s2).toEqual({ status: 'failed' })
    expect(state.steps.s3).toBeUndefined()
  })
})

describe('runHarness failure state persistence for condition errors', () => {
  it('updates state.json to failed when if condition throws (AC 2.1.3)', async () => {
    const config = {
      name: 'failure-if-throw',
      steps: [
        {
          id: 's1',
          run: async () => 'ok',
        },
        {
          id: 's2',
          if: () => {
            throw new Error('condition fail')
          },
          run: async () => 'unreached',
        },
      ],
    }

    const result = await runHarness(config, { runId: 'run-fail-2', workspaceDir: tempDir })
    expect(result.status).toBe('failed')

    const state = readState(tempDir, 'run-fail-2')
    expect(state.status).toBe('failed')
    expect(state.activeStepId).toBeNull()
    expect(state.steps.s1).toEqual({ status: 'passed', output: 'ok' })
    expect(state.steps.s2).toEqual({ status: 'failed' })
  })
})

describe('runHarness failure state persistence for schema errors', () => {
  it('updates state.json to failed when outputSchema fails (AC 2.1.3)', async () => {
    const config = {
      name: 'failure-schema',
      steps: [
        {
          id: 's1',
          run: async () => 'ok',
        },
        {
          id: 's2',
          outputSchema: z.object({
            count: z.number(),
          }),
          run: async () => ({ count: 'not-a-number' }),
        },
      ],
    }

    const result = await runHarness(config, { runId: 'run-fail-3', workspaceDir: tempDir })
    expect(result.status).toBe('failed')

    const state = readState(tempDir, 'run-fail-3')
    expect(state.status).toBe('failed')
    expect(state.activeStepId).toBeNull()
    expect(state.steps.s1).toEqual({ status: 'passed', output: 'ok' })
    expect(state.steps.s2).toEqual({ status: 'failed' })
  })
})

describe('runHarness concurrent execution persistence', () => {
  it('writes to distinct directories without collisions for concurrent runs (AC 2.1.4)', async () => {
    const makeHarness = (id: string) => ({
      name: `concurrent-${id}`,
      steps: [
        {
          id: 'work',
          run: async () => {
            await new Promise(resolve => setTimeout(resolve, 25))
            return `payload-${id}`
          },
        },
      ],
    })

    const [resA, resB] = await Promise.all([
      runHarness(makeHarness('A'), { runId: 'run-concurrent-A', workspaceDir: tempDir }),
      runHarness(makeHarness('B'), { runId: 'run-concurrent-B', workspaceDir: tempDir }),
    ])

    expect(resA.status).toBe('passed')
    expect(resB.status).toBe('passed')

    const stateA = readState(tempDir, 'run-concurrent-A')
    const stateB = readState(tempDir, 'run-concurrent-B')

    expect(stateA.runId).toBe('run-concurrent-A')
    expect(stateA.harnessName).toBe('concurrent-A')
    expect(stateA.steps.work?.output).toBe('payload-A')

    expect(stateB.runId).toBe('run-concurrent-B')
    expect(stateB.harnessName).toBe('concurrent-B')
    expect(stateB.steps.work?.output).toBe('payload-B')
  })
})
