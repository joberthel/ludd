import type { AgentRunner, HarnessConfig } from '../types/harness.js'
import { describe, expect, it } from 'vitest'
import { HarnessConfigError } from '../errors/harness-config-error.js'
import { runHarness } from './run-harness.js'

const UUID_V4_REGEX
  = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

describe('runHarness config validation', () => {
  it('rejects invalid harness configuration with HarnessConfigError', async () => {
    const invalidConfig = {
      name: '',
      steps: [],
    } as unknown as HarnessConfig
    await expect(runHarness(invalidConfig)).rejects.toThrow(HarnessConfigError)
  })

  it('rejects step missing run property with HarnessConfigError', async () => {
    const invalidConfig = {
      name: 'invalid-steps',
      steps: [
        { id: 'step-1' },
      ],
    } as unknown as HarnessConfig
    await expect(runHarness(invalidConfig)).rejects.toThrow(
      'must have a valid "run" property',
    )
  })
})

describe('runHarness runId handling', () => {
  const minimalConfig: HarnessConfig = {
    name: 'minimal',
    steps: [
      {
        id: 'step-1',
        run: () => 'ok',
      },
    ],
  }

  it('generates a valid UUID v4 when runId is omitted or whitespace', async () => {
    const resNoOptions = await runHarness(minimalConfig)
    expect(resNoOptions.runId).toMatch(UUID_V4_REGEX)

    const resEmpty = await runHarness(minimalConfig, {})
    expect(resEmpty.runId).toMatch(UUID_V4_REGEX)

    const resWhitespace = await runHarness(minimalConfig, { runId: '   ' })
    expect(resWhitespace.runId).toMatch(UUID_V4_REGEX)
  })

  it('uses provided runId and passes it into step context', async () => {
    let contextRunId = ''
    const config: HarnessConfig = {
      name: 'custom-run-id',
      steps: [
        {
          id: 'step-1',
          run: (ctx) => {
            contextRunId = ctx.runId
            return 'done'
          },
        },
      ],
    }

    const result = await runHarness(config, { runId: '  issue-124-9f8a  ' })
    expect(result.runId).toBe('issue-124-9f8a')
    expect(contextRunId).toBe('issue-124-9f8a')
  })
})

describe('runHarness context initialization', () => {
  it('populates initial context properties during step execution', async () => {
    let capturedCtx: any
    const config: HarnessConfig = {
      name: 'ctx-init',
      steps: [
        {
          id: 'step-1',
          run: (ctx) => {
            capturedCtx = ctx
          },
        },
      ],
    }

    await runHarness(config)
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

    const config: HarnessConfig = {
      name: 'three-step-pipeline',
      steps: [
        {
          id: 'step-1',
          run: () => {
            order.push('step-1')
            return 10
          },
        },
        {
          id: 'step-2',
          run: agent,
        },
        {
          id: 'step-3',
          run: (ctx) => {
            order.push('step-3')
            return (ctx.steps['step-2']?.output as number) + 5
          },
        },
      ],
    }

    const result = await runHarness(config)
    expect(order).toEqual(['step-1', 'step-2', 'step-3'])
    expect(result.status).toBe('passed')
    expect(result.steps['step-1']).toEqual({ status: 'passed', output: 10 })
    expect(result.steps['step-2']).toEqual({ status: 'passed', output: 20 })
    expect(result.steps['step-3']).toEqual({ status: 'passed', output: 25 })
  })
})

describe('runHarness sync failure handling', () => {
  it('halts on synchronous exception and records failure details', async () => {
    let downstreamCalled = false
    const failureError = new Error('Step 2 sync failure')

    const config: HarnessConfig = {
      name: 'failing-sync-pipeline',
      steps: [
        {
          id: 'step-1',
          run: () => 's1-ok',
        },
        {
          id: 'step-2',
          run: () => {
            throw failureError
          },
        },
        {
          id: 'step-3',
          run: () => {
            downstreamCalled = true
          },
        },
      ],
    }

    const result = await runHarness(config)
    expect(downstreamCalled).toBe(false)
    expect(result.status).toBe('failed')
    expect(result.failedStepId).toBe('step-2')
    expect(result.error).toBe(failureError)
    expect(result.steps['step-1']).toEqual({ status: 'passed', output: 's1-ok' })
    expect(result.steps['step-2']).toEqual({ status: 'failed', output: undefined })
    expect(result.steps['step-3']).toBeUndefined()
  })
})

describe('runHarness async and non-error failure handling', () => {
  it('halts on async promise rejection and agent runner failure', async () => {
    const asyncError = new Error('Async rejection in runner')
    const failingAgent: AgentRunner = {
      __kind: 'agent',
      execute: async () => {
        throw asyncError
      },
    }

    const config: HarnessConfig = {
      name: 'failing-async-pipeline',
      steps: [
        {
          id: 'step-agent-fail',
          run: failingAgent,
        },
      ],
    }

    const result = await runHarness(config)
    expect(result.status).toBe('failed')
    expect(result.failedStepId).toBe('step-agent-fail')
    expect(result.error).toBe(asyncError)
    expect(result.steps['step-agent-fail']).toEqual({
      status: 'failed',
      output: undefined,
    })
  })

  it('handles non-Error rejected values deterministically', async () => {
    const rejectionValue = { reason: 'custom error object' }
    const config: HarnessConfig = {
      name: 'non-error-pipeline',
      steps: [
        {
          id: 'step-reject-value',
          run: async () => Promise.reject(rejectionValue),
        },
      ],
    }

    const result = await runHarness(config)
    expect(result.status).toBe('failed')
    expect(result.failedStepId).toBe('step-reject-value')
    expect(result.error).toBe(rejectionValue)
    expect(result.steps['step-reject-value']).toEqual({
      status: 'failed',
      output: undefined,
    })
  })
})
