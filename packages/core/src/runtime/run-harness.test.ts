import type { AgentRunner, HarnessConfig, StepConfig, StepRunFn } from '../types/harness.js'
import { describe, expect, it } from 'vitest'
import { HarnessConfigError } from '../errors/harness-config-error.js'
import { runHarness } from './run-harness.js'

const UUID_V4_REGEX
  = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function createStep(
  id: string,
  run: StepRunFn<any> | AgentRunner<any>,
  ifPredicate?: (ctx: any) => boolean | Promise<boolean>,
): StepConfig {
  if (ifPredicate) {
    return { id, run, if: ifPredicate }
  }
  return { id, run }
}

describe('runHarness config validation', () => {
  it('rejects invalid harness configuration with HarnessConfigError', async () => {
    const invalidConfig = { name: '', steps: [] } as unknown as HarnessConfig
    await expect(runHarness(invalidConfig)).rejects.toThrow(HarnessConfigError)
  })

  it('rejects step missing run property with HarnessConfigError', async () => {
    const invalidConfig = {
      name: 'invalid',
      steps: [
        { id: 's1' },
      ],
    } as unknown as HarnessConfig
    await expect(runHarness(invalidConfig)).rejects.toThrow('must have a valid "run" property')
  })
})

describe('runHarness runId handling', () => {
  const minimalConfig: HarnessConfig = {
    name: 'minimal',
    steps: [
      createStep('step-1', () => 'ok'),
    ],
  }

  it('generates a valid UUID v4 when runId is omitted or whitespace', async () => {
    expect((await runHarness(minimalConfig)).runId).toMatch(UUID_V4_REGEX)
    expect((await runHarness(minimalConfig, {})).runId).toMatch(UUID_V4_REGEX)
    expect((await runHarness(minimalConfig, { runId: '   ' })).runId).toMatch(UUID_V4_REGEX)
  })

  it('uses provided runId and passes it into step context', async () => {
    let contextRunId = ''
    const result = await runHarness({
      name: 'custom-run-id',
      steps: [
        createStep('step-1', (ctx) => {
          contextRunId = ctx.runId
          return 'done'
        }),
      ],
    }, { runId: '  issue-124-9f8a  ' })
    expect(result.runId).toBe('issue-124-9f8a')
    expect(contextRunId).toBe('issue-124-9f8a')
  })
})

describe('runHarness context initialization', () => {
  it('populates initial context properties during step execution', async () => {
    let capturedCtx: any
    await runHarness({
      name: 'ctx-init',
      steps: [
        createStep('step-1', (ctx) => { capturedCtx = ctx }),
      ],
    })
    expect(capturedCtx.environments).toEqual({})
    expect(capturedCtx.matrix).toBeUndefined()
    expect(capturedCtx.artifacts).toEqual({})
  })
})

describe('runHarness 3-step pipeline with callback and agent runner', () => {
  it('executes step-1 -> step-2 -> step-3 in declaration order', async () => {
    const order: string[] = []
    const agent: AgentRunner<number> = {
      __kind: 'agent',
      execute: async (ctx) => {
        order.push('step-2')
        return (ctx.steps['step-1']?.output as number) * 2
      },
    }

    const result = await runHarness({
      name: 'three-step-pipeline',
      steps: [
        createStep('step-1', () => {
          order.push('step-1')
          return 10
        }),
        createStep('step-2', agent),
        createStep('step-3', (ctx) => {
          order.push('step-3')
          return (ctx.steps['step-2']?.output as number) + 5
        }),
      ],
    })
    expect(order).toEqual(['step-1', 'step-2', 'step-3'])
    expect(result.status).toBe('passed')
    expect(result.steps['step-1']).toEqual({ status: 'passed', output: 10 })
    expect(result.steps['step-2']).toEqual({ status: 'passed', output: 20 })
    expect(result.steps['step-3']).toEqual({ status: 'passed', output: 25 })
  })
})

describe('runHarness conditional skipping', () => {
  it('skips step when if returns false (sync and async) and preserves passed run', async () => {
    let syncRunCalled = false
    let asyncRunCalled = false
    const result = await runHarness({
      name: 'conditional-skip-pipeline',
      steps: [
        createStep('step-sync-skip', () => { syncRunCalled = true }, () => false),
        createStep('step-async-skip', () => { asyncRunCalled = true }, async () => false),
        createStep('step-pass', () => 'passed-output'),
      ],
    })
    expect(syncRunCalled).toBe(false)
    expect(asyncRunCalled).toBe(false)
    expect(result.status).toBe('passed')
    expect(result.steps['step-sync-skip']).toEqual({ status: 'skipped', output: undefined })
    expect(result.steps['step-async-skip']).toEqual({ status: 'skipped', output: undefined })
    expect(result.steps['step-pass']).toEqual({ status: 'passed', output: 'passed-output' })
  })
})

describe('runHarness conditional branching', () => {
  it('runs step when if returns true and branches on upstream status', async () => {
    const executed: string[] = []
    const result = await runHarness({
      name: 'conditional-branching-pipeline',
      steps: [
        createStep('implement-slices', () => {
          executed.push('implement-slices')
          return 'slices-done'
        }, async () => true),
        createStep('optional-skipped', () => {
          executed.push('optional-skipped')
        }, () => false),
        createStep('final-review-and-pr', () => {
          executed.push('final-review-and-pr')
          return 'pr-created'
        }, ctx => ctx.steps['implement-slices']?.status === 'passed'),
        createStep('never-run', () => {
          executed.push('never-run')
        }, ctx => ctx.steps['optional-skipped']?.status === 'passed'),
      ],
    })
    expect(executed).toEqual(['implement-slices', 'final-review-and-pr'])
    expect(result.status).toBe('passed')
    expect(result.steps['implement-slices']).toEqual({ status: 'passed', output: 'slices-done' })
    expect(result.steps['optional-skipped']).toEqual({ status: 'skipped', output: undefined })
    expect(result.steps['final-review-and-pr']).toEqual({ status: 'passed', output: 'pr-created' })
    expect(result.steps['never-run']).toEqual({ status: 'skipped', output: undefined })
  })
})

describe('runHarness conditional failure handling', () => {
  it('halts with failed status when if throws synchronously or rejects asynchronously', async () => {
    let downstreamCalled = false
    const syncError = new Error('Sync if error')
    const syncResult = await runHarness({
      name: 'if-sync-throw',
      steps: [
        createStep('step-1', () => 'ok', () => { throw syncError }),
        createStep('step-2', () => { downstreamCalled = true }),
      ],
    })
    expect(downstreamCalled).toBe(false)
    expect(syncResult.status).toBe('failed')
    expect(syncResult.failedStepId).toBe('step-1')
    expect(syncResult.error).toBe(syncError)
    expect(syncResult.steps['step-1']).toEqual({ status: 'failed', output: undefined })
    expect(syncResult.steps['step-2']).toBeUndefined()

    const asyncError = new Error('Async if rejection')
    const asyncResult = await runHarness({
      name: 'if-async-reject',
      steps: [
        createStep('step-1', () => 'ok', async () => Promise.reject(asyncError)),
      ],
    })
    expect(asyncResult.status).toBe('failed')
    expect(asyncResult.failedStepId).toBe('step-1')
    expect(asyncResult.error).toBe(asyncError)
    expect(asyncResult.steps['step-1']).toEqual({ status: 'failed', output: undefined })
  })
})

describe('runHarness sync execution failure', () => {
  it('halts on synchronous exception and records failure details', async () => {
    let downstreamCalled = false
    const failureError = new Error('Step 2 sync failure')

    const result = await runHarness({
      name: 'failing-sync-pipeline',
      steps: [
        createStep('step-1', () => 's1-ok'),
        createStep('step-2', () => { throw failureError }),
        createStep('step-3', () => { downstreamCalled = true }),
      ],
    })
    expect(downstreamCalled).toBe(false)
    expect(result.status).toBe('failed')
    expect(result.failedStepId).toBe('step-2')
    expect(result.error).toBe(failureError)
    expect(result.steps['step-1']).toEqual({ status: 'passed', output: 's1-ok' })
    expect(result.steps['step-2']).toEqual({ status: 'failed', output: undefined })
    expect(result.steps['step-3']).toBeUndefined()
  })
})

describe('runHarness async execution failure', () => {
  it('halts on async promise rejection and agent runner failure', async () => {
    const asyncError = new Error('Async rejection in runner')
    const failingAgent: AgentRunner = {
      __kind: 'agent',
      execute: async () => { throw asyncError },
    }

    const result = await runHarness({
      name: 'failing-async-pipeline',
      steps: [
        createStep('step-agent-fail', failingAgent),
      ],
    })
    expect(result.status).toBe('failed')
    expect(result.failedStepId).toBe('step-agent-fail')
    expect(result.error).toBe(asyncError)
    expect(result.steps['step-agent-fail']).toEqual({ status: 'failed', output: undefined })
  })

  it('handles non-Error rejected values deterministically', async () => {
    const rejectionValue = { reason: 'custom error object' }
    const result = await runHarness({
      name: 'non-error-pipeline',
      steps: [
        createStep('step-reject-value', async () => Promise.reject(rejectionValue)),
      ],
    })
    expect(result.status).toBe('failed')
    expect(result.failedStepId).toBe('step-reject-value')
    expect(result.error).toBe(rejectionValue)
    expect(result.steps['step-reject-value']).toEqual({ status: 'failed', output: undefined })
  })
})
