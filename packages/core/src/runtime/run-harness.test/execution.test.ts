import type { StepContext } from '../../types/context.js'
import type { AgentRunner, StepConfig, StepRunFn } from '../../types/harness.js'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runHarness } from '../run-harness.js'

function s(
  id: string,
  run: StepRunFn<any> | AgentRunner<any>,
  ifCond?: (ctx: StepContext<any, any>) => boolean | Promise<boolean>,
): StepConfig {
  return { id, run, if: ifCond }
}

let tempDir: string

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-exec-pipe-'))
})
afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

it('executes steps in declaration order with callbacks and agent runner', async () => {
  const order: string[] = []
  const agent: AgentRunner<number> = {
    __kind: 'agent',
    mode: 'read-only',
    prompt: 'double output',
    executeTurn: async ({ ctx }) => {
      order.push('s2')
      return {
        output: (ctx.steps.s1?.output as number) * 2,
        sessionId: 's2-session',
      }
    },
  }
  const result = await runHarness({
    name: 'pipeline',
    steps: [
      s('s1', () => {
        order.push('s1')
        return 10
      }),
      s('s2', agent),
      s('s3', (ctx) => {
        order.push('s3')
        return ((ctx.steps.s2?.output as { value: number })?.value) + 5
      }),
    ],
  }, { workspaceDir: tempDir })
  expect(order).toEqual(['s1', 's2', 's3'])
  expect(result.status).toBe('passed')
  expect(result.steps.s1?.output).toBe(10)
  expect(result.steps.s2?.output).toEqual({ value: 20, sessionId: 's2-session' })
  expect(result.steps.s3?.output).toBe(25)
})

it('keeps a previous config path when the resumed invocation omits it', async () => {
  const config = {
    name: 'config-identity',
    steps: [
      s('step', () => 'done'),
    ],
  }
  await runHarness(config, { workspaceDir: tempDir, runId: 'config-identity', configPath: 'saved.config.ts' })
  const resumed = await runHarness(config, { workspaceDir: tempDir, runId: 'config-identity' })
  expect(resumed.status).toBe('passed')
  expect(JSON.parse(await readFile(path.join(tempDir, '.harness/runs/config-identity/state.json'), 'utf8')).configPath).toBe('saved.config.ts')
})

describe('runHarness conditional execution', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-exec-cond-'))
  })
  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('skips step when if returns false (sync and async)', async () => {
    let syncCalled = false
    let asyncCalled = false
    const result = await runHarness({
      name: 'skip-pipeline',
      steps: [
        s('s-sync', () => { syncCalled = true }, () => false),
        s('s-async', () => { asyncCalled = true }, async () => false),
        s('s-pass', () => 'pass'),
      ],
    }, { workspaceDir: tempDir })
    expect(syncCalled).toBe(false)
    expect(asyncCalled).toBe(false)
    expect(result.status).toBe('passed')
    expect(result.steps['s-sync']?.status).toBe('skipped')
    expect(result.steps['s-async']?.status).toBe('skipped')
    expect(result.steps['s-pass']?.output).toBe('pass')
  })

  it('branches conditionally based on upstream step status', async () => {
    const executed: string[] = []
    const result = await runHarness({
      name: 'branch-pipeline',
      steps: [
        s('s1', () => { executed.push('s1') }, async () => true),
        s('s-skip', () => { executed.push('skip') }, () => false),
        s('s2', () => { executed.push('s2') }, ctx => ctx.steps.s1?.status === 'passed'),
        s('s3', () => { executed.push('s3') }, ctx => ctx.steps['s-skip']?.status === 'passed'),
      ],
    }, { workspaceDir: tempDir })
    expect(executed).toEqual(['s1', 's2'])
    expect(result.steps.s1?.status).toBe('passed')
    expect(result.steps['s-skip']?.status).toBe('skipped')
    expect(result.steps.s2?.status).toBe('passed')
    expect(result.steps.s3?.status).toBe('skipped')
  })
})

describe('runHarness condition failure handling', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-exec-condfail-'))
  })
  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('halts with failed status when if throws', async () => {
    const syncErr = new Error('sync')
    const syncRes = await runHarness({
      name: 'sync-if',
      steps: [
        s('s1', () => 'ok', () => { throw syncErr }),
        s('s2', () => 'unreached'),
      ],
    }, { workspaceDir: tempDir })
    expect(syncRes.status).toBe('failed')
    expect(syncRes.failedStepId).toBe('s1')
    expect(syncRes.error).toBe(syncErr)
    expect(syncRes.steps.s1).toEqual({ status: 'failed', output: undefined })
  })

  it('halts with failed status when if rejects', async () => {
    const asyncErr = new Error('async')
    const asyncRes = await runHarness({
      name: 'async-if',
      steps: [
        s('s1', () => 'ok', async () => Promise.reject(asyncErr)),
      ],
    }, { workspaceDir: tempDir })
    expect(asyncRes.status).toBe('failed')
    expect(asyncRes.failedStepId).toBe('s1')
  })
})

describe('runHarness runner failure handling', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-exec-runfail-'))
  })
  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('halts on sync throw in runner', async () => {
    const err = new Error('fail')
    const res = await runHarness({
      name: 'fail-pipeline',
      steps: [
        s('s1', () => 'ok'),
        s('s2', () => { throw err }),
        s('s3', () => 'unreached'),
      ],
    }, { workspaceDir: tempDir })
    expect(res.status).toBe('failed')
    expect(res.failedStepId).toBe('s2')
    expect(res.steps.s1?.status).toBe('passed')
    expect(res.steps.s2).toEqual({ status: 'failed', output: undefined })
    expect(res.steps.s3).toBeUndefined()
  })

  it('halts on async rejection in runner', async () => {
    const rejVal = { reason: 'custom' }
    const rejRes = await runHarness({
      name: 'rej-pipeline',
      steps: [
        s('s1', async () => Promise.reject(rejVal)),
      ],
    }, { workspaceDir: tempDir })
    expect(rejRes.status).toBe('failed')
    expect(rejRes.error).toBe(rejVal)
  })
})

describe('runHarness setup, teardown, and cwd/env propagation', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-exec-host-'))
  })
  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('runs setup once, resolves per-run and per-step cwd/env without leakage, and runs teardown', async () => {
    const calls: string[] = []
    const observed: Array<{ phase: string, cwd: string, env: Record<string, string> }> = []

    const res = await runHarness({
      name: 'host-exec-pipeline',
      cwd: 'base',
      env: ctx => ({ RUN_ID: ctx.runId, LAYER: 'harness' }),
      setup: async (ctx) => {
        calls.push(`setup:${ctx.runId}`)
        return {
          cwd: 'worktree',
          env: { LAYER: 'setup', WT: '1' },
        }
      },
      teardown: async (ctx) => {
        calls.push(`teardown:${ctx.runId}`)
      },
      steps: [
        {
          id: 'step-override',
          cwd: 'pkg',
          env: { LAYER: 'step1', STEP1: 'yes' },
          beforeStep: [
            {
              __kind: 'guardrail',
              type: 'exec',
              execute: async (input) => {
                observed.push({ phase: 's1-before', cwd: input.cwd, env: input.env })
                return { status: 'pass' }
              },
            },
          ],
          run: {
            __kind: 'agent',
            mode: 'read-only',
            prompt: 'p1',
            executeTurn: async (input) => {
              observed.push({ phase: 's1-agent', cwd: input.cwd, env: input.env })
              return { output: 's1', sessionId: input.sessionId }
            },
          },
          afterStep: [
            {
              __kind: 'guardrail',
              type: 'exec',
              execute: async (input) => {
                observed.push({ phase: 's1-after', cwd: input.cwd, env: input.env })
                return { status: 'pass' }
              },
            },
          ],
        },
        {
          id: 'step-inherit',
          run: {
            __kind: 'agent',
            mode: 'read-only',
            prompt: 'p2',
            executeTurn: async (input) => {
              observed.push({ phase: 's2-agent', cwd: input.cwd, env: input.env })
              return { output: 's2', sessionId: input.sessionId }
            },
          },
        },
      ],
    }, { runId: 'run-host-1', workspaceDir: tempDir })

    expect(res.status).toBe('passed')
    expect(calls).toEqual(['setup:run-host-1', 'teardown:run-host-1'])
    const expectedS1Cwd = path.resolve(tempDir, 'worktree', 'pkg')
    const expectedS2Cwd = path.resolve(tempDir, 'worktree')
    expect(observed).toEqual([
      {
        phase: 's1-before',
        cwd: expectedS1Cwd,
        env: {
          RUN_ID: 'run-host-1',
          LAYER: 'step1',
          WT: '1',
          STEP1: 'yes',
        },
      },
      {
        phase: 's1-agent',
        cwd: expectedS1Cwd,
        env: {
          RUN_ID: 'run-host-1',
          LAYER: 'step1',
          WT: '1',
          STEP1: 'yes',
        },
      },
      {
        phase: 's1-after',
        cwd: expectedS1Cwd,
        env: {
          RUN_ID: 'run-host-1',
          LAYER: 'step1',
          WT: '1',
          STEP1: 'yes',
        },
      },
      {
        phase: 's2-agent',
        cwd: expectedS2Cwd,
        env: { RUN_ID: 'run-host-1', LAYER: 'setup', WT: '1' },
      },
    ])
  })
})
