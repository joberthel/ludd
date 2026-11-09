import type { StepContext } from '../../types/context.js'
import type { EnvironmentAdapter, ProvisionedEnvironment } from '../../types/environment.js'
import type { Guardrail } from '../../types/guardrail.js'
import type { StepConfig } from '../../types/harness.js'
import type { RunStateSnapshot } from '../../types/state.js'
import fs from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  rehydrateEnvironmentsAndCheckHealth,
  resolveGuardrailEnvironment,
  resolveStepEnvironment,
} from '../environment-manager.js'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-adapter-wt-test-'))
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

function makeMockCtx(environments: Record<string, ProvisionedEnvironment> = {}): StepContext {
  return {
    runId: 'run-adapter-1',
    environments,
    steps: {},
    step: { id: 'step-1', output: undefined, attempt: 1 },
    matrix: undefined,
    artifacts: {} as any,
  }
}

function makeMockProvisionedEnv(id: string, branchName?: string): ProvisionedEnvironment {
  return {
    __kind: 'environment',
    id,
    type: 'git-worktree',
    workingDir: path.join(tmpDir, id),
    ...(branchName !== undefined
      ? { branchName }
      : {}),
    exec: vi.fn().mockResolvedValue({
      exitCode: 0,
      stdout: '',
      stderr: '',
      timedOut: false,
    }),
    ping: vi.fn().mockResolvedValue(true),
    teardown: vi.fn().mockResolvedValue(undefined),
  }
}

function makeMockSnapshot(): RunStateSnapshot {
  return {
    schemaVersion: 1,
    runId: 'run-adapter-1',
    harnessName: 'test-harness',
    status: 'running',
    activeStepId: 'step-1',
    steps: {},
    updatedAt: new Date().toISOString(),
  }
}

describe('resolveStepEnvironment with EnvironmentAdapter', () => {
  it('provisions adapter and registers in ctx and snapshot when not yet provisioned', async () => {
    const ctx = makeMockCtx()
    const snapshot = makeMockSnapshot()
    const mockEnv = makeMockProvisionedEnv('wt-env', 'ludd/run-wt-env')
    const provisionMock = vi.fn().mockResolvedValue(mockEnv)

    const adapter: EnvironmentAdapter = {
      __kind: 'environment-adapter',
      id: 'wt-env',
      type: 'git-worktree',
      provision: provisionMock,
    }

    const step: StepConfig = {
      id: 'step-wt',
      environment: adapter,
      run: () => {},
    }

    const resolved = await resolveStepEnvironment(step, ctx, tmpDir, snapshot, tmpDir)
    expect(resolved.id).toBe('wt-env')
    expect(provisionMock).toHaveBeenCalledTimes(1)
    expect(ctx.environments['wt-env']).toBe(mockEnv)
    expect(snapshot.environments?.['wt-env']).toEqual({
      id: 'wt-env',
      type: 'git-worktree',
      workingDir: mockEnv.workingDir,
      branchName: 'ludd/run-wt-env',
      tornDown: false,
    })
  })

  it('reuses existing environment in ctx without calling provision again', async () => {
    const existingEnv = makeMockProvisionedEnv('wt-env', 'ludd/run-wt-env')
    const ctx = makeMockCtx({ 'wt-env': existingEnv })
    const snapshot = makeMockSnapshot()
    const provisionMock = vi.fn()

    const adapter: EnvironmentAdapter = {
      __kind: 'environment-adapter',
      id: 'wt-env',
      type: 'git-worktree',
      provision: provisionMock,
    }

    const step: StepConfig = {
      id: 'step-wt-reuse',
      environment: adapter,
      run: () => {},
    }

    const resolved = await resolveStepEnvironment(step, ctx, tmpDir, snapshot, tmpDir)
    expect(resolved).toBe(existingEnv)
    expect(provisionMock).not.toHaveBeenCalled()
  })
})

describe('resolveGuardrailEnvironment with EnvironmentAdapter', () => {
  it('reuses existing environment in ctx when configured on guardrail', async () => {
    const existingEnv = makeMockProvisionedEnv('wt-rail-env')
    const ctx = makeMockCtx({ 'wt-rail-env': existingEnv })
    const provisionMock = vi.fn()

    const adapter: EnvironmentAdapter = {
      __kind: 'environment-adapter',
      id: 'wt-rail-env',
      type: 'git-worktree',
      provision: provisionMock,
    }

    const guardrail: Guardrail = {
      __kind: 'guardrail',
      type: 'fn',
      environment: adapter,
      execute: async () => ({ status: 'pass' }),
    }

    const resolved = await resolveGuardrailEnvironment(guardrail, ctx, existingEnv)
    expect(resolved).toBe(existingEnv)
    expect(provisionMock).not.toHaveBeenCalled()
  })

  it('provisions adapter when not yet present in ctx for guardrail', async () => {
    const ctx = makeMockCtx()
    const stepEnv = makeMockProvisionedEnv('step-env')
    const railEnv = makeMockProvisionedEnv('fresh-rail-env')
    const provisionMock = vi.fn().mockResolvedValue(railEnv)

    const adapter: EnvironmentAdapter = {
      __kind: 'environment-adapter',
      id: 'fresh-rail-env',
      type: 'git-worktree',
      provision: provisionMock,
    }

    const guardrail: Guardrail = {
      __kind: 'guardrail',
      type: 'fn',
      environment: adapter,
      execute: async () => ({ status: 'pass' }),
    }

    const resolved = await resolveGuardrailEnvironment(guardrail, ctx, stepEnv)
    expect(resolved.id).toBe('fresh-rail-env')
    expect(provisionMock).toHaveBeenCalledTimes(1)
    expect(ctx.environments['fresh-rail-env']).toBe(railEnv)
  })
})

describe('rehydrateEnvironmentsAndCheckHealth with git-worktree descriptors', () => {
  it('rehydrates git-worktree descriptor and skips tornDown descriptors', async () => {
    const wtDir = path.join(tmpDir, 'wt-rehydrate')
    fs.mkdirSync(wtDir, { recursive: true })
    const ctx = makeMockCtx()

    await rehydrateEnvironmentsAndCheckHealth({
      previousEnvironments: {
        'dead-wt': {
          id: 'dead-wt',
          type: 'git-worktree',
          workingDir: path.join(tmpDir, 'non-existent'),
          tornDown: true,
        },
        'live-host': {
          id: 'live-host',
          type: 'host',
          workingDir: tmpDir,
        },
      },
      ctx,
      workspaceDir: tmpDir,
    })

    expect(ctx.environments['dead-wt']).toBeUndefined()
    expect(ctx.environments['live-host']).toBeDefined()
  })
})
