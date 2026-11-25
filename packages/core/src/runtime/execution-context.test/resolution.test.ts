import type { StepContext } from '../../types/context.js'
import type { RunLifecycleContext } from '../../types/harness.js'
import path from 'node:path'
import process from 'node:process'
import { describe, expect, it } from 'vitest'
import { HarnessConfigError } from '../../errors/harness-config-error.js'
import {
  resolveExecutionContext,
  resolveRunExecutionContext,
  resolveStepExecutionContext,
} from '../execution-context.js'

function createLifecycleCtx(workspaceRoot = '/workspace/root'): {
  controller: AbortController
  lifecycleCtx: RunLifecycleContext
} {
  const controller = new AbortController()
  return {
    controller,
    lifecycleCtx: {
      runId: 'run-42',
      workspaceRoot,
      signal: controller.signal,
    },
  }
}

function createStepCtx(overrides?: Partial<StepContext>): StepContext {
  return {
    runId: 'run-42',
    steps: {},
    step: { id: 'step-1', output: undefined, attempt: 1 },
    matrix: undefined,
    artifacts: {} as StepContext['artifacts'],
    ...overrides,
  }
}

describe('resolveRunExecutionContext defaults and precedence', () => {
  it('defaults cwd to workspaceRoot (or process.cwd when empty/non-string) and env to empty object', async () => {
    const { lifecycleCtx } = createLifecycleCtx('/repo/project')
    const resolved = await resolveRunExecutionContext({
      config: {},
      lifecycleCtx,
    })
    expect(resolved).toEqual({
      cwd: path.resolve('/repo/project'),
      env: {},
    })

    for (const emptyRoot of ['   ', 123 as unknown as string]) {
      const { lifecycleCtx: invalidRootCtx } = createLifecycleCtx(emptyRoot)
      const fallback = await resolveRunExecutionContext({
        config: {},
        lifecycleCtx: invalidRootCtx,
      })
      expect(fallback).toEqual({
        cwd: process.cwd(),
        env: {},
      })
    }
  })

  it('resolves static/dynamic harness defaults and merges setupResult overrides', async () => {
    const { lifecycleCtx } = createLifecycleCtx('/repo')
    const resolved = await resolveRunExecutionContext({
      config: {
        cwd: 'packages/core',
        env: async ctx => ({ RUN_ID: ctx.runId, SHARED: 'harness' }),
      },
      lifecycleCtx,
      setupResult: {
        cwd: '.worktrees/run-42',
        env: { SHARED: 'setup', WORKTREE: '1' },
      },
    })

    expect(resolved).toEqual({
      cwd: path.resolve('/repo/.worktrees/run-42'),
      env: {
        RUN_ID: 'run-42',
        SHARED: 'setup',
        WORKTREE: '1',
      },
    })
  })
})

describe('resolveRunExecutionContext runtime validation', () => {
  it('rejects invalid dynamic harness or setupResult cwd and env values', async () => {
    const { lifecycleCtx } = createLifecycleCtx('/repo')

    await expect(resolveRunExecutionContext({
      config: {
        cwd: () => '   ',
      },
      lifecycleCtx,
    })).rejects.toThrow(HarnessConfigError)

    await expect(resolveRunExecutionContext({
      config: {
        cwd: () => 42 as unknown as string,
      },
      lifecycleCtx,
    })).rejects.toThrow(HarnessConfigError)

    await expect(resolveRunExecutionContext({
      config: {
        env: () => ({ BAD: 123 }) as unknown as Record<string, string>,
      },
      lifecycleCtx,
    })).rejects.toThrow(HarnessConfigError)

    await expect(resolveRunExecutionContext({
      config: {},
      lifecycleCtx,
      setupResult: { cwd: '' },
    })).rejects.toThrow(HarnessConfigError)

    await expect(resolveRunExecutionContext({
      config: {},
      lifecycleCtx,
      setupResult: {
        env: [] as unknown as Record<string, string>,
      },
    })).rejects.toThrow(HarnessConfigError)
  })
})

describe('resolveStepExecutionContext overrides', () => {
  it('inherits run context when step defines no overrides', async () => {
    const runExecutionContext = {
      cwd: '/repo/.worktrees/run-42',
      env: { A: '1', B: '2' },
    }
    const resolved = await resolveStepExecutionContext({
      step: {},
      stepCtx: createStepCtx(),
      runExecutionContext,
    })
    expect(resolved).toEqual(runExecutionContext)
  })

  it('applies static and dynamic step-level cwd and env overrides', async () => {
    const runExecutionContext = {
      cwd: '/repo/.worktrees/run-42',
      env: { A: '1', B: 'run' },
    }
    const stepCtx = createStepCtx({
      step: { id: 'implement', output: undefined, attempt: 2 },
    })

    const relativeResolved = await resolveStepExecutionContext({
      step: {
        cwd: ctx => `packages/${ctx.step.id}`,
        env: async ctx => ({
          B: 'step',
          ATTEMPT: String(ctx.step.attempt),
        }),
      },
      stepCtx,
      runExecutionContext,
    })
    expect(relativeResolved).toEqual({
      cwd: path.resolve('/repo/.worktrees/run-42/packages/implement'),
      env: { A: '1', B: 'step', ATTEMPT: '2' },
    })

    const absoluteResolved = await resolveStepExecutionContext({
      step: { cwd: '/custom/abs/dir' },
      stepCtx,
      runExecutionContext,
    })
    expect(absoluteResolved.cwd).toBe(path.resolve('/custom/abs/dir'))
  })
})

describe('resolveExecutionContext combined resolution', () => {
  it('resolves run-only, static step, and dynamic step overrides with stepCtx', async () => {
    const { lifecycleCtx } = createLifecycleCtx('/repo')

    const runOnly = await resolveExecutionContext({
      config: {
        cwd: 'apps/web',
        env: { APP: 'web' },
      },
      lifecycleCtx,
    })
    expect(runOnly).toEqual({
      cwd: path.resolve('/repo/apps/web'),
      env: { APP: 'web' },
    })

    const staticStep = await resolveExecutionContext({
      config: {
        env: { A: '1' },
      },
      lifecycleCtx,
      step: {
        cwd: 'sub',
        env: { B: '2' },
      },
    })
    expect(staticStep).toEqual({
      cwd: path.resolve('/repo/sub'),
      env: { A: '1', B: '2' },
    })

    const dynamicStep = await resolveExecutionContext({
      config: {
        env: { A: '1' },
      },
      lifecycleCtx,
      setupResult: { cwd: '.worktrees/run-42' },
      step: {
        cwd: ctx => `packages/${ctx.step.id}`,
        env: ctx => ({ B: ctx.runId }),
      },
      stepCtx: createStepCtx({
        step: { id: 'api', output: undefined, attempt: 1 },
      }),
    })
    expect(dynamicStep).toEqual({
      cwd: path.resolve('/repo/.worktrees/run-42/packages/api'),
      env: { A: '1', B: 'run-42' },
    })
  })

  it('throws when stepCtx is omitted for dynamic step properties', async () => {
    const { lifecycleCtx } = createLifecycleCtx('/repo')

    await expect(resolveExecutionContext({
      config: {},
      lifecycleCtx,
      step: {
        cwd: ctx => ctx.runId,
      },
    })).rejects.toThrow('stepCtx is required')

    await expect(resolveExecutionContext({
      config: {},
      lifecycleCtx,
      step: {
        env: ctx => ({ RUN: ctx.runId }),
      },
    })).rejects.toThrow('stepCtx is required')
  })
})
