import type { RunLifecycleContext } from '../../types/harness.js'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { executeWithHarnessLifecycle } from '../execution-context.js'

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

describe('executeWithHarnessLifecycle normal completion', () => {
  it('executes setup (with result or void), passes resolved context to run, and runs teardown', async () => {
    const { lifecycleCtx } = createLifecycleCtx('/repo')
    const events: string[] = []

    const output = await executeWithHarnessLifecycle({
      config: {
        env: { BASE: '1' },
        setup: async (ctx) => {
          events.push(`setup:${ctx.runId}`)
          return {
            cwd: '.worktrees/run-42',
            env: { WT: 'yes' },
          }
        },
        teardown: async (ctx) => {
          events.push(`teardown:${ctx.runId}`)
        },
      },
      lifecycleCtx,
      run: async (execCtx, setupResult) => {
        events.push(`run:${execCtx.cwd}`)
        expect(execCtx.env).toEqual({ BASE: '1', WT: 'yes' })
        expect(setupResult).toEqual({
          cwd: '.worktrees/run-42',
          env: { WT: 'yes' },
        })
        return 'finished'
      },
    })

    expect(output).toBe('finished')
    expect(events).toEqual([
      'setup:run-42',
      `run:${path.resolve('/repo/.worktrees/run-42')}`,
      'teardown:run-42',
    ])

    const voidSetupResult = await executeWithHarnessLifecycle({
      config: {
        setup: async () => {},
      },
      lifecycleCtx,
      run: (execCtx, setupResult) => {
        expect(execCtx.cwd).toBe(path.resolve('/repo'))
        expect(setupResult).toBeUndefined()
        return 42
      },
    })
    expect(voidSetupResult).toBe(42)
  })
})

describe('executeWithHarnessLifecycle failure handling', () => {
  it('guarantees teardown on setup failure, run failure, and teardown-only failure', async () => {
    const { lifecycleCtx } = createLifecycleCtx('/repo')
    const teardownOnSetupFail = vi.fn()
    await expect(executeWithHarnessLifecycle({
      config: {
        setup: async () => {
          throw new Error('setup boom')
        },
        teardown: teardownOnSetupFail,
      },
      lifecycleCtx,
      run: () => 'never',
    })).rejects.toThrow('setup boom')
    expect(teardownOnSetupFail).toHaveBeenCalledTimes(1)

    const teardownOnRunFail = vi.fn()
    await expect(executeWithHarnessLifecycle({
      config: { teardown: teardownOnRunFail },
      lifecycleCtx,
      run: () => {
        throw new Error('step boom')
      },
    })).rejects.toThrow('step boom')
    expect(teardownOnRunFail).toHaveBeenCalledTimes(1)

    await expect(executeWithHarnessLifecycle({
      config: {
        teardown: async () => {
          throw new Error('teardown boom')
        },
      },
      lifecycleCtx,
      run: () => 'ok',
    })).rejects.toThrow('teardown boom')
  })

  it('never masks the primary error when both primary execution and teardown fail', async () => {
    const { lifecycleCtx } = createLifecycleCtx('/repo')
    const onTeardownError = vi.fn()

    await expect(executeWithHarnessLifecycle({
      config: {
        teardown: async () => {
          throw new Error('secondary teardown failure')
        },
      },
      lifecycleCtx,
      run: () => {
        throw new Error('primary step failure')
      },
      onTeardownError,
    })).rejects.toThrow('primary step failure')
    expect(onTeardownError).toHaveBeenCalledTimes(1)

    await expect(executeWithHarnessLifecycle({
      config: {
        teardown: async () => {
          throw new Error('secondary teardown failure')
        },
      },
      lifecycleCtx,
      run: () => {
        throw new Error('primary failure without callback')
      },
    })).rejects.toThrow('primary failure without callback')
  })
})

describe('executeWithHarnessLifecycle AbortSignal cancellation', () => {
  it('guarantees teardown on pre-aborted signal and abort during setup', async () => {
    const preAborted = createLifecycleCtx('/repo')
    preAborted.controller.abort(new Error('already aborted'))
    const setupSpy = vi.fn()
    const teardownPre = vi.fn((ctx: RunLifecycleContext) => {
      expect(ctx.signal.aborted).toBe(false)
    })

    await expect(executeWithHarnessLifecycle({
      config: { setup: setupSpy, teardown: teardownPre },
      lifecycleCtx: preAborted.lifecycleCtx,
      run: () => 'never',
    })).rejects.toThrow('already aborted')
    expect(setupSpy).not.toHaveBeenCalled()
    expect(teardownPre).toHaveBeenCalledTimes(1)

    const midSetup = createLifecycleCtx('/repo')
    const teardownMidSetup = vi.fn((ctx: RunLifecycleContext) => {
      expect(ctx.signal.aborted).toBe(false)
    })
    await expect(executeWithHarnessLifecycle({
      config: {
        setup: () => {
          midSetup.controller.abort(new Error('aborted during setup'))
        },
        teardown: teardownMidSetup,
      },
      lifecycleCtx: midSetup.lifecycleCtx,
      run: () => 'never',
    })).rejects.toThrow('aborted during setup')
    expect(teardownMidSetup).toHaveBeenCalledTimes(1)
  })

  it('guarantees teardown and skips run if signal aborts during context resolution', async () => {
    const midResolve = createLifecycleCtx('/repo')
    const teardownSpy = vi.fn()
    const runSpy = vi.fn()

    await expect(executeWithHarnessLifecycle({
      config: {
        cwd: () => {
          midResolve.controller.abort(new Error('aborted during resolve'))
          return '/repo'
        },
        teardown: teardownSpy,
      },
      lifecycleCtx: midResolve.lifecycleCtx,
      run: runSpy,
    })).rejects.toThrow('aborted during resolve')
    expect(runSpy).not.toHaveBeenCalled()
    expect(teardownSpy).toHaveBeenCalledTimes(1)
  })
})
