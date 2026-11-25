import type { Guardrail, HarnessConfig, StepContext } from '../src/index.js'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { mockAgent } from '@luddjs/agents'
import { execGuardrail } from '@luddjs/guardrails'
import { expect } from 'vitest'
import { spawn } from '../src/index.js'

export interface ObservedExecution {
  cwd: string
  env: Record<string, string | undefined>
}

export const ENV_KEYS = [
  'SCOPE',
  'SHARED',
  'HARNESS_VAR',
  'SETUP_VAR',
  'STEP_VAR',
  'STEP_ID',
  'GUARDRAIL_VAR',
]

const INSPECT_SCRIPT = [
  'const fs = require("node:fs");',
  'const keys = JSON.parse(process.argv[1]);',
  'const env = {};',
  'for (const k of keys) env[k] = process.env[k];',
  'console.log(JSON.stringify({ cwd: fs.realpathSync(process.cwd()), env }));',
].join(' ')

export async function inspectSpawnEnv(
  cwd: string,
  env: Record<string, string>,
  keys: string[],
): Promise<ObservedExecution> {
  const res = await spawn({
    command: process.execPath,
    args: [
      '-e',
      INSPECT_SCRIPT,
      JSON.stringify(keys),
    ],
    cwd,
    env,
  })
  expect(res.exitCode).toBe(0)
  return JSON.parse(res.stdout.trim()) as ObservedExecution
}

export function createEnvInspectorGuardrail(
  keys: string[],
  sink: ObservedExecution[],
  overrides?: { cwd?: string, env?: Record<string, string> },
): Guardrail {
  return execGuardrail({
    ...(overrides?.cwd !== undefined
      ? { cwd: overrides.cwd }
      : {}),
    ...(overrides?.env !== undefined
      ? { env: overrides.env }
      : {}),
    command: [
      process.execPath,
      '-e',
      INSPECT_SCRIPT,
      JSON.stringify(keys),
    ],
    formatter: (res) => {
      if (res.exitCode !== 0) {
        return { status: 'fail', body: res.stderr }
      }
      sink.push(JSON.parse(res.stdout.trim()) as ObservedExecution)
      return { status: 'pass' }
    },
  })
}

function buildInheritedStep(keys: string[], observations: ObservedExecution[]) {
  return {
    id: 'inherited',
    beforeStep: [
      createEnvInspectorGuardrail(keys, observations),
    ],
    run: mockAgent({
      mode: 'read-only',
      prompt: 'Inspect inherited run execution context',
      responses: [
        async (input) => {
          observations.push(await inspectSpawnEnv(input.cwd, input.env, keys))
          return { nextDir: 'dynamic-pkg' }
        },
      ],
    }),
    afterStep: [
      createEnvInspectorGuardrail(keys, observations),
    ],
  }
}

function buildDynamicOverrideStep(keys: string[], observations: ObservedExecution[]) {
  return {
    id: 'dynamic-override',
    cwd: (ctx: StepContext) => path.join('packages', (ctx.steps.inherited?.output as { nextDir: string }).nextDir),
    env: async (ctx: StepContext) => ({ SHARED: 'step-dynamic', STEP_ID: ctx.step.id }),
    run: mockAgent({
      mode: 'read-only',
      prompt: 'Inspect dynamic step overrides',
      responses: [
        async (input) => {
          observations.push(await inspectSpawnEnv(input.cwd, input.env, keys))
          return { done: true }
        },
      ],
    }),
    afterStep: [
      createEnvInspectorGuardrail(keys, observations, {
        cwd: '..',
        env: { GUARDRAIL_VAR: 'rail' },
      }),
    ],
  }
}

export function buildPrecedenceHarnessConfig(keys: string[], observations: ObservedExecution[]): HarnessConfig {
  return {
    name: 'epic-07-cwd-env-precedence',
    cwd: 'ignored-harness-cwd',
    env: ctx => ({ SCOPE: 'harness-dyn', SHARED: 'harness', HARNESS_VAR: `h-${ctx.runId}` }),
    setup: async ({ runId }) => ({
      cwd: 'setup-ws',
      env: { SHARED: 'setup', SETUP_VAR: `s-${runId}` },
    }),
    steps: [
      buildInheritedStep(keys, observations),
      {
        id: 'static-override',
        cwd: 'packages/static-pkg',
        env: { SHARED: 'step-static', STEP_VAR: 'static' },
        beforeStep: [
          createEnvInspectorGuardrail(keys, observations),
        ],
        run: async () => ({ ok: true }),
        afterStep: [
          createEnvInspectorGuardrail(keys, observations),
        ],
      },
      buildDynamicOverrideStep(keys, observations),
    ],
  }
}

export function createPrecedenceWorkspace(tempDir: string) {
  const setupDir = path.join(tempDir, 'setup-ws')
  const staticStepDir = path.join(setupDir, 'packages', 'static-pkg')
  const dynamicStepDir = path.join(setupDir, 'packages', 'dynamic-pkg')
  const dynamicHarnessDir = path.join(tempDir, 'dyn-harness-run-b')
  for (const dir of [
    path.join(tempDir, 'ignored-harness-cwd'),
    staticStepDir,
    dynamicStepDir,
    dynamicHarnessDir,
  ]) {
    fs.mkdirSync(dir, { recursive: true })
  }
  return {
    setupDir,
    staticStepDir,
    dynamicStepDir,
    dynamicHarnessDir,
  }
}

export function assertPrecedenceObservations(
  observations: ObservedExecution[],
  dirs: ReturnType<typeof createPrecedenceWorkspace>,
): void {
  const realSetup = fs.realpathSync(dirs.setupDir)
  const realStatic = fs.realpathSync(dirs.staticStepDir)
  const realDynamic = fs.realpathSync(dirs.dynamicStepDir)
  const realDynamicParent = fs.realpathSync(path.join(dirs.setupDir, 'packages'))

  expect(observations).toHaveLength(7)
  expect(observations.slice(0, 3)).toEqual(Array.from({ length: 3 }, () => ({
    cwd: realSetup,
    env: {
      SCOPE: 'harness-dyn',
      SHARED: 'setup',
      HARNESS_VAR: 'h-run-a',
      SETUP_VAR: 's-run-a',
    },
  })))
  expect(observations.slice(3, 5)).toEqual(Array.from({ length: 2 }, () => ({
    cwd: realStatic,
    env: {
      SCOPE: 'harness-dyn',
      SHARED: 'step-static',
      HARNESS_VAR: 'h-run-a',
      SETUP_VAR: 's-run-a',
      STEP_VAR: 'static',
    },
  })))
  expect(observations[5]).toEqual({
    cwd: realDynamic,
    env: {
      SCOPE: 'harness-dyn',
      SHARED: 'step-dynamic',
      HARNESS_VAR: 'h-run-a',
      SETUP_VAR: 's-run-a',
      STEP_ID: 'dynamic-override',
    },
  })
  expect(observations[6]).toEqual({
    cwd: realDynamicParent,
    env: {
      SCOPE: 'harness-dyn',
      SHARED: 'step-dynamic',
      HARNESS_VAR: 'h-run-a',
      SETUP_VAR: 's-run-a',
      STEP_ID: 'dynamic-override',
      GUARDRAIL_VAR: 'rail',
    },
  })
}
