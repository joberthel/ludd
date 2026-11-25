import type { StepContext } from '../../types/context.js'
import type { StepConfig } from '../../types/harness.js'
import type { RunStateSnapshot } from '../../types/state.js'
import fs from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EnvironmentUnreachableError } from '../../errors/environment-unreachable-error.js'
import { readRunState } from '../../persistence/state-store.js'
import {
  createHostEnvironmentFromDescriptor,
  recordEnvironment,
  rehydrateEnvironmentsAndCheckHealth,
  resolveGuardrailEnvironment,
  resolveStepEnvironment,
} from '../environment-manager.js'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-env-rehydrate-'))
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

function createMockContext(): StepContext {
  return {
    runId: 'run-1',
    environments: {},
    steps: {},
    step: { id: 's1', output: undefined, attempt: 1 },
    matrix: undefined,
    artifacts: {
      get: async () => null,
      getJson: async () => null,
      put: async () => {},
      list: async () => [],
      has: async () => false,
    },
  }
}

function createMockSnapshot(): RunStateSnapshot {
  return {
    schemaVersion: 1,
    runId: 'run-1',
    harnessName: 'test-harness',
    workflowName: 'test-harness',
    status: 'running',
    activeStepId: 's1',
    steps: {},
    updatedAt: new Date().toISOString(),
  }
}

describe('createHostEnvironmentFromDescriptor', () => {
  it('constructs a host ProvisionedEnvironment from a descriptor', async () => {
    const env = createHostEnvironmentFromDescriptor({
      id: 'custom-host',
      type: 'host',
      workingDir: tmpDir,
    })
    expect(env.__kind).toBe('environment')
    expect(env.id).toBe('custom-host')
    expect(env.type).toBe('host')
    expect(env.workingDir).toBe(tmpDir)
    expect(await env.ping()).toBe(true)

    const execRes = await env.exec(['node', '-e', 'console.log("ok")'])
    expect(execRes.stdout.trim()).toBe('ok')
    await expect(env.teardown()).resolves.toBeUndefined()
  })

  it('ping returns false when workingDir does not exist', async () => {
    const nonExistent = path.join(tmpDir, 'does-not-exist')
    const env = createHostEnvironmentFromDescriptor({
      id: 'missing-host',
      type: 'host',
      workingDir: nonExistent,
    })
    expect(await env.ping()).toBe(false)
  })
})

describe('recordEnvironment', () => {
  it('records environment in context and snapshot, persisting atomically', () => {
    const ctx = createMockContext()
    const snapshot = createMockSnapshot()
    const env = createHostEnvironmentFromDescriptor({
      id: 'env-1',
      type: 'host',
      workingDir: tmpDir,
    })

    recordEnvironment(env, ctx, snapshot, tmpDir)
    expect(ctx.environments['env-1']).toBe(env)
    expect(snapshot.environments?.['env-1']).toEqual({
      id: 'env-1',
      type: 'host',
      workingDir: tmpDir,
      tornDown: false,
    })

    const persisted = readRunState(tmpDir)
    expect(persisted.environments?.['env-1']).toEqual({
      id: 'env-1',
      type: 'host',
      workingDir: tmpDir,
      tornDown: false,
    })
  })

  it('records environment in context and snapshot without persisting when runDir omitted', () => {
    const ctx = createMockContext()
    const snapshot = createMockSnapshot()
    const env = createHostEnvironmentFromDescriptor({
      id: 'env-no-dir',
      type: 'host',
      workingDir: tmpDir,
    })
    recordEnvironment(env, ctx, snapshot)
    expect(snapshot.environments?.['env-no-dir']).toBeDefined()
  })
})

describe('resolveStepEnvironment & resolveGuardrailEnvironment persistence', () => {
  it('persists step environment descriptor in snapshot and state.json', async () => {
    const ctx = createMockContext()
    const snapshot = createMockSnapshot()
    const step: StepConfig = {
      id: 'step-persist',
      run: async () => ({}),
    }

    const env = await resolveStepEnvironment(step, ctx, tmpDir, snapshot, tmpDir)
    expect(env.id).toBe('host')
    expect(snapshot.environments?.host).toBeDefined()
    const persisted = readRunState(tmpDir)
    expect(persisted.environments?.host?.workingDir).toBe(tmpDir)
  })

  it('persists guardrail override environment in snapshot and state.json', async () => {
    const ctx = createMockContext()
    const snapshot = createMockSnapshot()
    const stepEnv = createHostEnvironmentFromDescriptor({
      id: 'step-env',
      type: 'host',
      workingDir: tmpDir,
    })
    const overrideSubDir = path.join(tmpDir, 'override')
    fs.mkdirSync(overrideSubDir)

    const guardrail = {
      __kind: 'guardrail' as const,
      type: 'exec' as const,
      environment: createHostEnvironmentFromDescriptor({
        id: 'rail-env',
        type: 'host',
        workingDir: overrideSubDir,
      }),
      execute: async () => ({ status: 'pass' as const }),
    }

    const resolved = await resolveGuardrailEnvironment(guardrail, ctx, stepEnv, snapshot, tmpDir)
    expect(resolved.id).toBe('rail-env')
    expect(snapshot.environments?.['rail-env']?.workingDir).toBe(overrideSubDir)
    const persisted = readRunState(tmpDir)
    expect(persisted.environments?.['rail-env']).toBeDefined()
  })
})

describe('rehydrateEnvironmentsAndCheckHealth reconstruction', () => {
  it('reconstructs previous environments and verifies health ping', async () => {
    const ctx = createMockContext()
    await rehydrateEnvironmentsAndCheckHealth({
      previousEnvironments: {
        'prev-env': { id: 'prev-env', type: 'host', workingDir: tmpDir },
      },
      ctx,
      workspaceDir: tmpDir,
    })
    expect(ctx.environments['prev-env']).toBeDefined()
    expect(ctx.environments['prev-env'].id).toBe('prev-env')
  })

  it('preserves existing environment in context if already populated', async () => {
    const ctx = createMockContext()
    const existing = createHostEnvironmentFromDescriptor({
      id: 'prev-env',
      type: 'host',
      workingDir: tmpDir,
    })
    ctx.environments['prev-env'] = existing
    await rehydrateEnvironmentsAndCheckHealth({
      previousEnvironments: {
        'prev-env': { id: 'prev-env', type: 'host', workingDir: tmpDir },
      },
      ctx,
      workspaceDir: tmpDir,
    })
    expect(ctx.environments['prev-env']).toBe(existing)
  })
})

describe('rehydrateEnvironmentsAndCheckHealth failure handling', () => {
  it('throws EnvironmentUnreachableError if any environment ping fails', async () => {
    const ctx = createMockContext()
    const missingDir = path.join(tmpDir, 'vanished-env')
    await expect(
      rehydrateEnvironmentsAndCheckHealth({
        previousEnvironments: {
          'dead-env': { id: 'dead-env', type: 'host', workingDir: missingDir },
        },
        ctx,
        workspaceDir: tmpDir,
      }),
    ).rejects.toThrow(EnvironmentUnreachableError)
  })

  it('resolves activeStep.environment if configured and pings it', async () => {
    const ctx = createMockContext()
    const missingDir = path.join(tmpDir, 'step-vanished')
    const activeStep: StepConfig = {
      id: 'active-s',
      environment: createHostEnvironmentFromDescriptor({
        id: 'step-env',
        type: 'host',
        workingDir: missingDir,
      }),
      run: async () => ({}),
    }

    await expect(
      rehydrateEnvironmentsAndCheckHealth({
        ctx,
        activeStep,
        workspaceDir: tmpDir,
      }),
    ).rejects.toThrow(EnvironmentUnreachableError)
  })
})

describe('recordEnvironment metadata persistence (#78)', () => {
  it('persists containerWorkingDir, bridgeHost, and whitelistEnv onto snapshot.environments', () => {
    const snapshot = {
      schemaVersion: 1 as const,
      runId: 'run-78',
      harnessName: 'h',
      workflowName: 'w',
      status: 'running' as const,
      activeStepId: 's1',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      environments: {} as Record<string, unknown>,
    }
    const ctx = {
      runId: 'run-78',
      stepId: 's1',
      attempt: 1,
      environments: {} as Record<string, unknown>,
      artifacts: {},
      stepOutputs: {},
    }
    const env = {
      __kind: 'environment' as const,
      id: 'dock-78',
      type: 'docker-worktree',
      workingDir: '/tmp/wt',
      containerWorkingDir: '/app',
      bridgeHost: '172.17.0.1',
      whitelistEnv: ['FOO', 'MISSING_KEY'],
      exec: async () => ({
        exitCode: 0,
        stdout: '',
        stderr: '',
        timedOut: false,
      }),
      ping: async () => true,
      teardown: async () => {},
    }

    recordEnvironment(env, ctx as any, snapshot as any)

    expect(snapshot.environments['dock-78']).toEqual(expect.objectContaining({
      containerWorkingDir: '/app',
      bridgeHost: '172.17.0.1',
      whitelistEnv: ['FOO', 'MISSING_KEY'],
    }))
  })

  it('delegates descriptor rehydration to matching EnvironmentAdapter.rehydrate when available', async () => {
    const ctx = createMockContext()
    const rehydratedEnv = {
      __kind: 'environment' as const,
      id: 'custom-env',
      type: 'custom-type',
      workingDir: '/tmp/custom',
      exec: async () => ({
        exitCode: 0,
        stdout: 'delegated',
        stderr: '',
        timedOut: false,
      }),
      ping: async () => true,
      teardown: async () => {},
    }
    const rehydrateMock = vi.fn().mockResolvedValue(rehydratedEnv)
    const adapter = {
      __kind: 'environment-adapter' as const,
      id: 'custom-env',
      type: 'custom-type',
      provision: vi.fn(),
      rehydrate: rehydrateMock,
    }

    await rehydrateEnvironmentsAndCheckHealth({
      previousEnvironments: {
        'custom-env': {
          id: 'custom-env',
          type: 'custom-type',
          workingDir: '/tmp/custom',
          tornDown: false,
        },
      },
      ctx,
      adapters: [adapter],
      workspaceDir: '/tmp',
    })

    expect(rehydrateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'custom-env',
        type: 'custom-type',
        workingDir: '/tmp/custom',
      }),
      expect.objectContaining({
        runId: ctx.runId,
        workspaceDir: '/tmp',
        ctx,
      }),
    )
    expect(ctx.environments['custom-env']).toBe(rehydratedEnv)
  })

  it('delegates descriptor rehydration by type match when activeStep provides an EnvironmentAdapter', async () => {
    const ctx = createMockContext()
    const rehydratedEnv = {
      __kind: 'environment' as const,
      id: 'prev-env',
      type: 'custom-type',
      workingDir: '/tmp/prev',
      exec: async () => ({
        exitCode: 0,
        stdout: '',
        stderr: '',
        timedOut: false,
      }),
      ping: async () => true,
      teardown: async () => {},
    }
    const rehydrateMock = vi.fn().mockResolvedValue(rehydratedEnv)
    const stepAdapter = {
      __kind: 'environment-adapter' as const,
      id: 'step-env',
      type: 'custom-type',
      provision: vi.fn().mockResolvedValue({
        ...rehydratedEnv,
        id: 'step-env',
      }),
      rehydrate: rehydrateMock,
    }

    await rehydrateEnvironmentsAndCheckHealth({
      previousEnvironments: {
        'prev-env': {
          id: 'prev-env',
          type: 'custom-type',
          workingDir: '/tmp/prev',
          tornDown: false,
        },
      },
      activeStep: {
        id: 'step-1',
        environment: stepAdapter,
      } as any,
      ctx,
      workspaceDir: '/tmp',
    })

    expect(rehydrateMock).toHaveBeenCalledTimes(1)
    expect(ctx.environments['prev-env']).toBe(rehydratedEnv)
  })
})
