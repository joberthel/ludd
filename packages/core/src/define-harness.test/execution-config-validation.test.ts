import type { MatrixCursor, StepContext } from '../types/context.js'
import type {
  HarnessExecutionConfig,
  PriorStepContext,
  RunLifecycleContext,
} from '../types/harness.js'
import { describe, expect, expectTypeOf, it } from 'vitest'
import { z } from 'zod'
import { createHarness, defineHarness, validateHarnessConfig } from '../define-harness.js'
import { HarnessConfigError } from '../errors/harness-config-error.js'

const minimalStep = {
  id: 's1',
  run: () => 'ok',
}

describe('validateHarnessConfig harness-level cwd validation', () => {
  it('accepts static non-empty cwd and dynamic cwd function', () => {
    const staticConfig = validateHarnessConfig({
      name: 'static-cwd',
      cwd: '/tmp/workspace',
      steps: [minimalStep],
    })
    expect(staticConfig.cwd).toBe('/tmp/workspace')

    const cwdFn = (ctx: RunLifecycleContext) => `${ctx.workspaceRoot}/sub`
    const dynamicConfig = validateHarnessConfig({
      name: 'dynamic-cwd',
      cwd: cwdFn,
      steps: [minimalStep],
    })
    expect(dynamicConfig.cwd).toBe(cwdFn)
  })

  it('rejects empty, whitespace-only, or non-string/non-function harness cwd', () => {
    for (const invalidCwd of ['', '   ', 123, null, [], {}]) {
      expect(() => validateHarnessConfig({
        name: 'bad-cwd',
        cwd: invalidCwd,
        steps: [minimalStep],
      })).toThrow(HarnessConfigError)
      expect(() => validateHarnessConfig({
        name: 'bad-cwd',
        cwd: invalidCwd,
        steps: [minimalStep],
      })).toThrow('Harness config "cwd" must be a non-empty trimmed string or a function when provided.')
    }
  })
})

describe('validateHarnessConfig harness-level env validation', () => {
  it('accepts plain record of strings, null-prototype record, and dynamic env function', () => {
    const nullProtoEnv = Object.assign(Object.create(null) as Record<string, string>, {
      NODE_ENV: 'test',
    })
    const staticConfig = validateHarnessConfig({
      name: 'static-env',
      env: nullProtoEnv,
      steps: [minimalStep],
    })
    expect(staticConfig.env).toBe(nullProtoEnv)

    const envFn = (ctx: RunLifecycleContext) => ({ RUN_ID: ctx.runId })
    const dynamicConfig = validateHarnessConfig({
      name: 'dynamic-env',
      env: envFn,
      steps: [minimalStep],
    })
    expect(dynamicConfig.env).toBe(envFn)
  })

  it('rejects non-plain objects, invalid keys, and invalid values', () => {
    for (const invalidEnv of [
      'bad',
      42,
      null,
      [],
      new Date(),
      new Map(),
    ]) {
      expect(() => validateHarnessConfig({
        name: 'bad-env',
        env: invalidEnv,
        steps: [minimalStep],
      })).toThrow('Harness config "env" must be a plain object of string values.')
    }

    for (const badKeyEnv of [
      { '   ': 'val' },
      { 'A=B': 'val' },
      { 'A\0B': 'val' },
    ]) {
      expect(() => validateHarnessConfig({
        name: 'bad-env-key',
        env: badKeyEnv,
        steps: [minimalStep],
      })).toThrow('Harness config "env" keys must be non-empty trimmed strings without "=" or null bytes.')
    }

    for (const badValEnv of [
      { PORT: 3000 },
      { PORT: 'a\0b' },
    ]) {
      expect(() => validateHarnessConfig({
        name: 'bad-env-val',
        env: badValEnv,
        steps: [minimalStep],
      })).toThrow('Harness config "env" entry "PORT" must be a string without null bytes.')
    }
  })
})

describe('validateHarnessConfig setup and teardown validation', () => {
  it('accepts optional setup and teardown functions', () => {
    const setup = async (ctx: RunLifecycleContext) => ({ cwd: ctx.workspaceRoot })
    const teardown = async () => {}
    const config = validateHarnessConfig({
      name: 'lifecycle-hooks',
      setup,
      teardown,
      steps: [minimalStep],
    })
    expect(config.setup).toBe(setup)
    expect(config.teardown).toBe(teardown)
  })

  it('rejects non-function setup or teardown hooks', () => {
    expect(() => validateHarnessConfig({
      name: 'bad-setup',
      setup: 'not-a-fn',
      steps: [minimalStep],
    })).toThrow('Harness config "setup" must be a function when provided.')

    expect(() => validateHarnessConfig({
      name: 'bad-teardown',
      teardown: {},
      steps: [minimalStep],
    })).toThrow('Harness config "teardown" must be a function when provided.')
  })
})

describe('validateHarnessConfig step-level cwd and env validation', () => {
  it('accepts static and dynamic cwd and env on steps', () => {
    const config = validateHarnessConfig({
      name: 'step-overrides',
      steps: [
        {
          id: 's1',
          cwd: 'packages/core',
          env: { STEP_FLAG: 'true' },
          run: () => 'ok',
        },
        {
          id: 's2',
          cwd: (ctx: StepContext) => `/tmp/${ctx.runId}`,
          env: (ctx: StepContext) => ({ STEP_ID: ctx.step.id }),
          run: () => 'ok',
        },
      ],
    })
    expect(config.steps[0].cwd).toBe('packages/core')
    expect(config.steps[1].env).toBeTypeOf('function')
  })

  it('rejects invalid step cwd and env values', () => {
    expect(() => validateHarnessConfig({
      name: 'bad-step-cwd',
      steps: [
        {
          id: 's1',
          cwd: '  ',
          run: () => {},
        },
      ],
    })).toThrow('Step "s1" "cwd" must be a non-empty trimmed string or a function when provided.')

    expect(() => validateHarnessConfig({
      name: 'bad-step-env',
      steps: [
        {
          id: 's1',
          env: ['bad'],
          run: () => {},
        },
      ],
    })).toThrow('Step "s1" "env" must be a plain object of string values.')

    expect(() => validateHarnessConfig({
      name: 'bad-step-env-val',
      steps: [
        {
          id: 's1',
          env: { GOOD: 'ok', BAD: false },
          run: () => {},
        },
      ],
    })).toThrow('Step "s1" "env" entry "BAD" must be a string without null bytes.')
  })
})

describe('defineHarness execution config typing', () => {
  it('contextually types RunLifecycleContext across defineHarness overloads', () => {
    const single = defineHarness({
      name: 'single-plain',
      cwd: (ctx) => {
        expectTypeOf(ctx).toEqualTypeOf<RunLifecycleContext>()
        return ctx.workspaceRoot
      },
      env: (ctx) => {
        expectTypeOf(ctx).toEqualTypeOf<RunLifecycleContext>()
        return { RUN_ID: ctx.runId }
      },
      setup: async (ctx) => {
        expectTypeOf(ctx).toEqualTypeOf<RunLifecycleContext>()
        return {
          cwd: ctx.workspaceRoot,
          env: { FROM_SETUP: '1' },
        }
      },
      teardown: async (ctx) => {
        expectTypeOf(ctx).toEqualTypeOf<RunLifecycleContext>()
      },
      steps: [
        {
          id: 's0',
          cwd: ctx => `/tmp/${ctx.runId}`,
          env: { A: '1' },
          outputSchema: z.object({
            ok: z.boolean(),
          }),
          run: () => ({ ok: true }),
        },
      ],
    })
    expectTypeOf(single).toExtend<HarnessExecutionConfig>()
    expect(single.name).toBe('single-plain')
  })

  it('types Step0Constraint and matrix step cwd/env overrides', () => {
    const artifactSchema = z.object({
      title: z.string(),
    })
    const matrix = defineHarness({
      name: 'two-step-artifact-matrix',
      cwd: '/repo',
      env: { BASE: '1' },
      steps: [
        {
          id: 'plan',
          artifacts: {
            'tasks.json': {
              schema: z.array(artifactSchema),
            },
          },
          cwd: (ctx) => {
            expectTypeOf(ctx).toEqualTypeOf<PriorStepContext<[]>>()
            return `/tmp/${ctx.runId}`
          },
          env: (ctx) => {
            expectTypeOf(ctx).toEqualTypeOf<PriorStepContext<[]>>()
            return { STEP: ctx.step.id }
          },
          run: () => ({ ok: true }),
        },
        {
          id: 'implement',
          matrix: { itemsFromArtifact: 'tasks.json' },
          cwd: (ctx) => {
            expectTypeOf(ctx.matrix).toEqualTypeOf<MatrixCursor<{ title: string }>>()
            return `/work/${ctx.matrix.item.title}`
          },
          env: (ctx) => {
            expectTypeOf(ctx.matrix).toEqualTypeOf<MatrixCursor<{ title: string }>>()
            return { TASK: ctx.matrix.item.title }
          },
          run: ctx => ctx.matrix.item.title,
        },
      ],
    })
    expect(matrix.cwd).toBe('/repo')
  })
})

describe('createHarness execution config typing and validation', () => {
  it('supports cwd, env, setup, teardown on createHarness options and steps', () => {
    const built = createHarness('builder-exec', {
      cwd: (ctx) => {
        expectTypeOf(ctx).toEqualTypeOf<RunLifecycleContext>()
        return ctx.workspaceRoot
      },
      env: (ctx) => {
        expectTypeOf(ctx).toEqualTypeOf<RunLifecycleContext>()
        return { RUN: ctx.runId }
      },
      setup: async (ctx) => {
        expectTypeOf(ctx).toEqualTypeOf<RunLifecycleContext>()
        return { cwd: ctx.workspaceRoot }
      },
      teardown: async (ctx) => {
        expectTypeOf(ctx).toEqualTypeOf<RunLifecycleContext>()
      },
    })
      .step({
        id: 'init',
        outputSchema: z.object({
          dir: z.string(),
        }),
        run: () => ({ dir: 'sub' }),
      })
      .step({
        id: 'work',
        cwd: ctx => ctx.steps.init.output!.dir,
        env: ctx => ({ TARGET: ctx.steps.init.output!.dir }),
        run: () => 'done',
      })
      .build()

    expect(built.name).toBe('builder-exec')
    expect(() => createHarness('bad-builder', { cwd: '  ' }).step(minimalStep).build()).toThrow(HarnessConfigError)
  })
})
