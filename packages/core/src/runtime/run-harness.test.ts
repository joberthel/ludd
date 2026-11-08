import type { StepContext } from '../types/context.js'
import type { AgentRunner, HarnessConfig, StepConfig, StepRunFn } from '../types/harness.js'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { HarnessConfigError } from '../errors/harness-config-error.js'
import { StepOutputValidationError } from '../errors/step-output-validation-error.js'
import { runHarness } from './run-harness.js'

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function s(
  id: string,
  run: StepRunFn<any> | AgentRunner<any>,
  ifCond?: (ctx: StepContext<any, any>) => boolean | Promise<boolean>,
  schema?: z.ZodType,
): StepConfig {
  return {
    id,
    run,
    if: ifCond,
    outputSchema: schema,
  }
}

describe('runHarness configuration and context', () => {
  const minimal: HarnessConfig = {
    name: 'minimal',
    steps: [
      s('s1', () => 'ok'),
    ],
  }

  it('rejects invalid harness configuration with HarnessConfigError', async () => {
    const invalid = { name: '', steps: [] } as unknown as HarnessConfig
    await expect(runHarness(invalid)).rejects.toThrow(HarnessConfigError)
    const noRun = {
      name: 'inv',
      steps: [
        { id: 's1' },
      ],
    } as unknown as HarnessConfig
    await expect(runHarness(noRun)).rejects.toThrow('must have a valid "run" property')
  })

  it('generates a valid UUID v4 when runId is omitted or whitespace', async () => {
    expect((await runHarness(minimal)).runId).toMatch(UUID_V4)
    expect((await runHarness(minimal, {})).runId).toMatch(UUID_V4)
    expect((await runHarness(minimal, { runId: '   ' })).runId).toMatch(UUID_V4)
  })

  it('passes runId and initializes empty context properties', async () => {
    let captured: any
    const result = await runHarness({
      name: 'ctx-init',
      steps: [
        s('s1', (ctx) => { captured = ctx }),
      ],
    }, { runId: '  issue-124-9f8a  ' })
    expect(result.runId).toBe('issue-124-9f8a')
    expect(captured.runId).toBe('issue-124-9f8a')
    expect(captured.environments).toEqual({})
    expect(captured.artifacts).toEqual({})
  })
})

describe('runHarness pipeline order and agent runner', () => {
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
    })
    expect(order).toEqual(['s1', 's2', 's3'])
    expect(result.status).toBe('passed')
    expect(result.steps.s1?.output).toBe(10)
    expect(result.steps.s2?.output).toBe(20)
    expect(result.steps.s3?.output).toBe(25)
  })
})

describe('runHarness conditional execution', () => {
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
    })
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
    })
    expect(executed).toEqual(['s1', 's2'])
    expect(result.steps.s1?.status).toBe('passed')
    expect(result.steps['s-skip']?.status).toBe('skipped')
    expect(result.steps.s2?.status).toBe('passed')
    expect(result.steps.s3?.status).toBe('skipped')
  })
})

describe('runHarness condition failure', () => {
  it('halts with failed status when if throws or rejects', async () => {
    const syncErr = new Error('sync')
    const syncRes = await runHarness({
      name: 'sync-if',
      steps: [
        s('s1', () => 'ok', () => { throw syncErr }),
        s('s2', () => 'unreached'),
      ],
    })
    expect(syncRes.status).toBe('failed')
    expect(syncRes.failedStepId).toBe('s1')
    expect(syncRes.error).toBe(syncErr)
    expect(syncRes.steps.s1).toEqual({ status: 'failed', output: undefined })
    expect(syncRes.steps.s2).toBeUndefined()

    const asyncErr = new Error('async')
    const asyncRes = await runHarness({
      name: 'async-if',
      steps: [
        s('s1', () => 'ok', async () => Promise.reject(asyncErr)),
      ],
    })
    expect(asyncRes.status).toBe('failed')
    expect(asyncRes.failedStepId).toBe('s1')
  })
})

describe('runHarness execution failure', () => {
  it('halts on sync throw or async rejection in runner', async () => {
    const err = new Error('fail')
    const res = await runHarness({
      name: 'fail-pipeline',
      steps: [
        s('s1', () => 'ok'),
        s('s2', () => { throw err }),
        s('s3', () => 'unreached'),
      ],
    })
    expect(res.status).toBe('failed')
    expect(res.failedStepId).toBe('s2')
    expect(res.steps.s1?.status).toBe('passed')
    expect(res.steps.s2).toEqual({ status: 'failed', output: undefined })
    expect(res.steps.s3).toBeUndefined()

    const rejVal = { reason: 'custom' }
    const rejRes = await runHarness({
      name: 'rej-pipeline',
      steps: [
        s('s1', async () => Promise.reject(rejVal)),
      ],
    })
    expect(rejRes.status).toBe('failed')
    expect(rejRes.error).toBe(rejVal)
  })
})

describe('runHarness outputSchema success', () => {
  it('applies defaults and transforms to step and context on success', async () => {
    const schema = z.object({
      title: z.string().transform(v => v.trim().toUpperCase()),
      count: z.number().default(42),
    })
    let downstreamSeen: unknown
    const result = await runHarness({
      name: 'schema-success',
      steps: [
        s('step-1', () => ({ title: '  hello  ' }), undefined, schema),
        s('step-2', (ctx) => {
          downstreamSeen = ctx.steps['step-1']?.output
          return 'done'
        }),
      ],
    })
    expect(result.status).toBe('passed')
    expect(result.steps['step-1']?.output).toEqual({ title: 'HELLO', count: 42 })
    expect(downstreamSeen).toEqual({ title: 'HELLO', count: 42 })
    expect(result.steps['step-2']?.output).toBe('done')
  })

  it('validates agent runner output against outputSchema', async () => {
    const schema = z.object({
      score: z.number(),
    })
    const agent: AgentRunner = {
      __kind: 'agent',
      execute: async () => ({ score: 100 }),
    }
    const result = await runHarness({
      name: 'agent-schema',
      steps: [
        s('agent-step', agent, undefined, schema),
      ],
    })
    expect(result.status).toBe('passed')
    expect(result.steps['agent-step']?.output).toEqual({ score: 100 })
  })
})

describe('runHarness outputSchema failure', () => {
  it('fails step and halts pipeline with StepOutputValidationError on violation', async () => {
    const schema = z.object({
      commitMessage: z.string().min(5),
      status: z.enum(['ready', 'needs_clarification']),
    })
    let downstreamCalled = false
    const rawBad = { commitMessage: 'fix', status: 'invalid' }
    const result = await runHarness({
      name: 'schema-fail',
      steps: [
        s('implement-slices', () => rawBad, undefined, schema),
        s('downstream', () => { downstreamCalled = true }),
      ],
    })
    expect(downstreamCalled).toBe(false)
    expect(result.status).toBe('failed')
    expect(result.failedStepId).toBe('implement-slices')
    expect(result.steps['implement-slices']).toEqual({ status: 'failed', output: undefined })
    expect(result.steps.downstream).toBeUndefined()
    expect(result.error).toBeInstanceOf(StepOutputValidationError)
    const valErr = result.error as StepOutputValidationError
    expect(valErr.stepId).toBe('implement-slices')
    expect(valErr.rawOutput).toBe(rawBad)
    expect(valErr.issues).toHaveLength(2)
  })
})
