import type { ProvisionedEnvironment } from '../../types/environment.js'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readLedgerEvents } from '../../persistence/ledger-writer.js'
import { readRunState } from '../../persistence/state-store.js'
import { applyCleanupPolicy } from '../cleanup-policy.js'
import { runHarness } from '../run-harness.js'

let tempDir: string

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-cleanup-policy-'))
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

function createMockEnvironment(id: string, teardown = vi.fn().mockResolvedValue(undefined)) {
  const env: ProvisionedEnvironment = {
    __kind: 'environment',
    id,
    type: 'host',
    workingDir: tempDir,
    exec: vi.fn(),
    ping: vi.fn().mockResolvedValue(true),
    teardown,
  }
  return { env, teardown }
}

describe('declarative cleanupPolicy onSuccess keep and defaults', () => {
  it('defaults to keep on success when cleanupPolicy is omitted', async () => {
    const runId = 'default-keep-success'
    const { env, teardown } = createMockEnvironment('env-success-default')

    const result = await runHarness(
      {
        name: 'test-default-keep',
        steps: [
          {
            id: 'step-1',
            environment: env,
            run: async () => 'ok',
          },
        ],
      },
      { runId, workspaceDir: tempDir },
    )

    expect(result.status).toBe('passed')
    expect(teardown).not.toHaveBeenCalled()
    const state = readRunState(path.join(tempDir, '.harness', 'runs', runId))
    expect(state.environments?.['env-success-default']).toBeDefined()
  })

  it('preserves environments when onSuccess is keep', async () => {
    const runId = 'keep-on-success'
    const { env, teardown } = createMockEnvironment('env-success-keep')

    const result = await runHarness(
      {
        name: 'test-keep-success',
        cleanupPolicy: { onSuccess: 'keep', onFailure: 'destroy' },
        steps: [
          {
            id: 'step-1',
            environment: env,
            run: async () => 'ok',
          },
        ],
      },
      { runId, workspaceDir: tempDir },
    )

    expect(result.status).toBe('passed')
    expect(teardown).not.toHaveBeenCalled()
    const state = readRunState(path.join(tempDir, '.harness', 'runs', runId))
    expect(state.environments?.['env-success-keep']).toBeDefined()
  })
})

describe('declarative cleanupPolicy onSuccess destroy', () => {
  it('tears down environments when onSuccess is destroy', async () => {
    const runId = 'destroy-on-success'
    const { env, teardown } = createMockEnvironment('env-success-destroy')

    const result = await runHarness(
      {
        name: 'test-destroy-success',
        cleanupPolicy: { onSuccess: 'destroy' },
        steps: [
          {
            id: 'step-1',
            environment: env,
            run: async () => 'ok',
          },
        ],
      },
      { runId, workspaceDir: tempDir },
    )

    expect(result.status).toBe('passed')
    expect(teardown).toHaveBeenCalledTimes(1)
    const runDir = path.join(tempDir, '.harness', 'runs', runId)
    const state = readRunState(runDir)
    expect(state.environments).toEqual({})
    const events = readLedgerEvents(runDir)
    expect(events.some(e => e.eventType === 'run.teardown')).toBe(true)
  })
})

describe('declarative cleanupPolicy onFailure destroy', () => {
  it('tears down environments when onFailure is destroy', async () => {
    const runId = 'destroy-on-failure'
    const { env, teardown } = createMockEnvironment('env-fail-destroy')

    const result = await runHarness(
      {
        name: 'test-destroy-failure',
        cleanupPolicy: { onFailure: 'destroy' },
        steps: [
          {
            id: 'step-fail',
            environment: env,
            run: async () => {
              throw new Error('step error')
            },
          },
        ],
      },
      { runId, workspaceDir: tempDir },
    )

    expect(result.status).toBe('failed')
    expect(teardown).toHaveBeenCalledTimes(1)
    const runDir = path.join(tempDir, '.harness', 'runs', runId)
    const state = readRunState(runDir)
    expect(state.environments).toEqual({})
  })
})

describe('declarative cleanupPolicy onFailure keep', () => {
  it('preserves environments when onFailure is keep or omitted', async () => {
    const runId = 'keep-on-failure'
    const { env, teardown } = createMockEnvironment('env-fail-keep')

    const result = await runHarness(
      {
        name: 'test-keep-failure',
        cleanupPolicy: { onSuccess: 'destroy', onFailure: 'keep' },
        steps: [
          {
            id: 'step-fail',
            environment: env,
            run: async () => {
              throw new Error('step error')
            },
          },
        ],
      },
      { runId, workspaceDir: tempDir },
    )

    expect(result.status).toBe('failed')
    expect(teardown).not.toHaveBeenCalled()
    const state = readRunState(path.join(tempDir, '.harness', 'runs', runId))
    expect(state.environments?.['env-fail-keep']).toBeDefined()
  })
})

describe('applyCleanupPolicy unit branches', () => {
  it('does nothing when policy is undefined and run passes', async () => {
    await expect(applyCleanupPolicy(undefined, {
      runId: 'r-1',
      status: 'passed',
      steps: {},
    }, 'r-1', tempDir)).resolves.toBeUndefined()
  })
})
