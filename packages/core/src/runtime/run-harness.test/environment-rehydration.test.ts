import type { HarnessConfig } from '../../types/harness.js'
import type { RunStateSnapshot } from '../../types/state.js'
import fs from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EnvironmentUnreachableError } from '../../errors/environment-unreachable-error.js'
import { readLedgerEvents } from '../../persistence/ledger-writer.js'
import { RUNNER_PID_FILE } from '../../persistence/pid-lock.js'
import { readRunState, resolveRunDir, writeRunStateAtomic } from '../../persistence/state-store.js'
import { createHostEnvironmentFromDescriptor } from '../environment-manager.js'
import { runHarness } from '../run-harness.js'

let tempDir: string

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-env-rehydrate-test-'))
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

describe('runHarness crash rehydration: unreachable environment (AC 5.5.1)', () => {
  it('fails with EnvironmentUnreachableError when environment is dead', async () => {
    const runId = 'ac-5-5-1-unreachable'
    const runDir = resolveRunDir(tempDir, runId)
    const deadDir = path.join(tempDir, 'dead-workspace')

    const snapshot: RunStateSnapshot = {
      schemaVersion: 1,
      runId,
      harnessName: 'health-check-harness',
      status: 'running',
      activeStepId: 'step-resume',
      environments: {
        'feature-env': { id: 'feature-env', type: 'host', workingDir: deadDir },
      },
      steps: {
        'step-setup': { status: 'passed', output: 'ok' },
      },
      updatedAt: new Date().toISOString(),
    }
    writeRunStateAtomic(runDir, snapshot)

    const config: HarnessConfig = {
      name: 'health-check-harness',
      steps: [
        {
          id: 'step-setup',
          run: async () => 'ok',
        },
        {
          id: 'step-resume',
          run: async () => 'resumed',
        },
      ],
    }

    await expect(runHarness(config, { runId, workspaceDir: tempDir })).rejects.toThrow(EnvironmentUnreachableError)

    const finalState = readRunState(runDir)
    expect(finalState.status).toBe('failed')

    const events = readLedgerEvents(runDir)
    const failedEvent = events.find(e => e.eventType === 'run.failed')
    expect(failedEvent).toBeDefined()
    expect(failedEvent?.payload.error).toContain('feature-env')
    expect(fs.existsSync(path.join(runDir, RUNNER_PID_FILE))).toBe(false)
  })
})

describe('runHarness crash rehydration: reachable environment (AC 5.5.1)', () => {
  it('resumes execution when all referenced environments are reachable', async () => {
    const runId = 'ac-5-5-1-reachable'
    const runDir = resolveRunDir(tempDir, runId)
    const liveDir = path.join(tempDir, 'live-workspace')
    fs.mkdirSync(liveDir)

    const snapshot: RunStateSnapshot = {
      schemaVersion: 1,
      runId,
      harnessName: 'reachable-harness',
      status: 'running',
      activeStepId: 'step-resume',
      environments: {
        'live-env': { id: 'live-env', type: 'host', workingDir: liveDir },
      },
      steps: {
        'step-setup': { status: 'passed', output: 'ok' },
      },
      updatedAt: new Date().toISOString(),
    }
    writeRunStateAtomic(runDir, snapshot)

    let resumedExecuted = false
    const config: HarnessConfig = {
      name: 'reachable-harness',
      steps: [
        {
          id: 'step-setup',
          run: async () => 'ok',
        },
        {
          id: 'step-resume',
          run: async (ctx) => {
            resumedExecuted = true
            expect(ctx.environments['live-env']).toBeDefined()
            return 'resumed-ok'
          },
        },
      ],
    }

    const result = await runHarness(config, { runId, workspaceDir: tempDir })
    expect(result.status).toBe('passed')
    expect(resumedExecuted).toBe(true)
    expect(result.steps['step-resume']?.status).toBe('passed')
  })
})

describe('runHarness crash rehydration: active step environment check', () => {
  it('fails when active step environment directory is missing', async () => {
    const runId = 'ac-5-5-1-step-env'
    const runDir = resolveRunDir(tempDir, runId)
    const deadDir = path.join(tempDir, 'dead-step-env')

    const snapshot: RunStateSnapshot = {
      schemaVersion: 1,
      runId,
      harnessName: 'step-env-harness',
      status: 'running',
      activeStepId: 'step-configured',
      steps: {},
      updatedAt: new Date().toISOString(),
    }
    writeRunStateAtomic(runDir, snapshot)

    const config: HarnessConfig = {
      name: 'step-env-harness',
      steps: [
        {
          id: 'step-configured',
          environment: createHostEnvironmentFromDescriptor({
            id: 'configured-env',
            type: 'host',
            workingDir: deadDir,
          }),
          run: async () => 'ok',
        },
      ],
    }

    await expect(runHarness(config, { runId, workspaceDir: tempDir })).rejects.toThrow(EnvironmentUnreachableError)
  })
})
