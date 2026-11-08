import type { HarnessConfig } from '../../types/harness.js'
import type { RunStateSnapshot } from '../../types/state.js'
import fs from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SchemaVersionMismatchError } from '../../errors/schema-version-mismatch-error.js'
import { readLedgerEvents } from '../../persistence/ledger-writer.js'
import { RUNNER_PID_FILE } from '../../persistence/pid-lock.js'
import { readRunState, resolveRunDir, writeRunStateAtomic } from '../../persistence/state-store.js'
import { runHarness } from '../run-harness.js'

let tempDir: string

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-rehydrate-test-'))
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

function getPaths(runId: string) {
  const runDir = resolveRunDir(tempDir, runId)
  return {
    runDir,
    pidFile: path.join(runDir, RUNNER_PID_FILE),
    stateFile: path.join(runDir, 'state.json'),
  }
}

describe('runHarness crash rehydration: step skipping (AC 2.5.1)', () => {
  it('skips passed and skipped steps without re-executing them', async () => {
    let s1Calls = 0
    let s2Calls = 0
    let shouldS3Fail = true

    const config: HarnessConfig = {
      name: 'resume-pipeline',
      steps: [
        {
          id: 'step-1',
          run: async () => {
            s1Calls += 1
            return 's1'
          },
        },
        {
          id: 'step-2',
          if: () => false,
          run: async () => {
            s2Calls += 1
            return 's2'
          },
        },
        {
          id: 'step-3',
          run: async () => {
            if (shouldS3Fail) {
              throw new Error('Step 3 fault')
            }
            return 's3'
          },
        },
      ],
    }

    const runId = 'ac-2-5-1-run'
    await runHarness(config, { runId, workspaceDir: tempDir })

    shouldS3Fail = false
    const res = await runHarness(config, { runId, workspaceDir: tempDir })

    expect(res.status).toBe('passed')
    expect(s1Calls).toBe(1)
    expect(s2Calls).toBe(0)
    expect(res.steps['step-1']?.status).toBe('passed')
    expect(res.steps['step-2']?.status).toBe('skipped')
    expect(res.steps['step-3']?.status).toBe('passed')
  })
})

describe('runHarness crash rehydration: typed output delivery (AC 2.5.2)', () => {
  it('delivers rehydrated output to downstream steps', async () => {
    let receivedOutput: unknown
    let shouldFail = true

    const config: HarnessConfig = {
      name: 'output-delivery',
      steps: [
        {
          id: 'producer',
          run: async () => ({ token: 'abc-123', count: 42 }),
        },
        {
          id: 'consumer',
          run: async (ctx) => {
            if (shouldFail) {
              throw new Error('fail first')
            }
            receivedOutput = ctx.steps.producer?.output
            return { ok: true }
          },
        },
      ],
    }

    const runId = 'ac-2-5-2-run'
    await runHarness(config, { runId, workspaceDir: tempDir })

    shouldFail = false
    const res = await runHarness(config, { runId, workspaceDir: tempDir })

    expect(res.status).toBe('passed')
    expect(receivedOutput).toEqual({ token: 'abc-123', count: 42 })
  })
})

describe('runHarness crash rehydration: ledger events (AC 2.5.3)', () => {
  it('records run.resumed event followed by remaining step lifecycle', async () => {
    let failStep2 = true
    const runId = 'ac-2-5-3-run'
    const { runDir } = getPaths(runId)

    const config: HarnessConfig = {
      name: 'ledger-harness',
      steps: [
        {
          id: 's1',
          run: async () => 'out1',
        },
        {
          id: 's2',
          run: async () => {
            if (failStep2) {
              throw new Error('fail-s2')
            }
            return 'out2'
          },
        },
      ],
    }

    await runHarness(config, { runId, workspaceDir: tempDir })
    failStep2 = false
    await runHarness(config, { runId, workspaceDir: tempDir })

    const events = readLedgerEvents(runDir)
    expect(events.map(e => ({ type: e.eventType, stepId: e.stepId }))).toEqual([
      { type: 'run.started', stepId: null },
      { type: 'step.started', stepId: 's1' },
      { type: 'step.passed', stepId: 's1' },
      { type: 'step.started', stepId: 's2' },
      { type: 'step.failed', stepId: 's2' },
      { type: 'run.failed', stepId: null },
      { type: 'run.resumed', stepId: null },
      { type: 'step.started', stepId: 's2' },
      { type: 'step.passed', stepId: 's2' },
      { type: 'run.passed', stepId: null },
    ])
    expect(events[6].payload).toEqual({ harnessName: 'ledger-harness' })
  })
})

describe('runHarness crash rehydration: schema version validation (AC 2.5.4)', () => {
  it('rejects incompatible schemaVersion and cleans up runner.pid', async () => {
    const runId = 'ac-2-5-4-run'
    const { runDir, pidFile, stateFile } = getPaths(runId)

    fs.mkdirSync(runDir, { recursive: true })
    fs.writeFileSync(stateFile, '{"schemaVersion":42}\n', 'utf-8')

    const config: HarnessConfig = {
      name: 'invalid-version',
      steps: [
        {
          id: 's1',
          run: async () => 'ok',
        },
      ],
    }

    await expect(
      runHarness(config, { runId, workspaceDir: tempDir }),
    ).rejects.toThrow(SchemaVersionMismatchError)
    expect(fs.existsSync(pidFile)).toBe(false)
  })
})

describe('runHarness crash rehydration: completed runs and dead pid recovery', () => {
  it('handles rehydration when all steps are completed and dead pid exists', async () => {
    const runId = 'complete-rehydrate-run'
    const { runDir, pidFile } = getPaths(runId)

    const snapshot: RunStateSnapshot = {
      schemaVersion: 1,
      runId,
      harnessName: 'complete-harness',
      status: 'running',
      activeStepId: null,
      steps: {
        s1: { status: 'passed', output: 'ok1' },
        s2: { status: 'skipped', output: undefined },
      },
      updatedAt: new Date().toISOString(),
    }
    writeRunStateAtomic(runDir, snapshot)
    fs.writeFileSync(pidFile, '99999999\n', 'utf-8')

    let s1Called = false
    const config: HarnessConfig = {
      name: 'complete-harness',
      steps: [
        {
          id: 's1',
          run: async () => {
            s1Called = true
            return 'fresh'
          },
        },
        {
          id: 's2',
          run: async () => 'fresh2',
        },
      ],
    }

    const result = await runHarness(config, { runId, workspaceDir: tempDir })
    expect(result.status).toBe('passed')
    expect(s1Called).toBe(false)
    expect(fs.existsSync(pidFile)).toBe(false)

    const finalState = readRunState(runDir)
    expect(finalState.status).toBe('passed')
    expect(finalState.activeStepId).toBeNull()
  })
})
