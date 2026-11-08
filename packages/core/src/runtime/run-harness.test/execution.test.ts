import type { StepContext } from '../../types/context.js'
import type { AgentRunner, StepConfig, StepRunFn } from '../../types/harness.js'
import { mkdtemp, rm } from 'node:fs/promises'
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

describe('runHarness pipeline order and agent runner', () => {
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
      execute: async (ctx) => {
        order.push('s2')
        return (ctx.steps.s1?.output as number) * 2
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
          return (ctx.steps.s2?.output as number) + 5
        }),
      ],
    }, { workspaceDir: tempDir })
    expect(order).toEqual(['s1', 's2', 's3'])
    expect(result.status).toBe('passed')
    expect(result.steps.s1?.output).toBe(10)
    expect(result.steps.s2?.output).toBe(20)
    expect(result.steps.s3?.output).toBe(25)
  })
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
