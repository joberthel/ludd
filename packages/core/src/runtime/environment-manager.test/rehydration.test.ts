import type { StepContext } from '../../types/context.js'
import type { Guardrail } from '../../types/guardrail.js'
import type { StepConfig } from '../../types/harness.js'
import type { RunStateSnapshot } from '../../types/state.js'
import fs from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
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
    })

    const persisted = readRunState(tmpDir)
    expect(persisted.environments?.['env-1']).toEqual({
      id: 'env-1',
      type: 'host',
      workingDir: tmpDir,
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

    const guardrail: Guardrail = {
      __kind: 'guardrail',
      type: 'exec',
      environment: createHostEnvironmentFromDescriptor({
        id: 'rail-env',
        type: 'host',
        workingDir: overrideSubDir,
      }),
      execute: async () => ({ status: 'pass' }),
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
