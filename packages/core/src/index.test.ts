import type { StepContext } from './index.js'
import { describe, expect, it } from 'vitest'
import * as core from './index.js'

describe('@ludd/core public exports contract', () => {
  it('exports resolveDynamicProperty as a function', () => {
    expect(typeof core.resolveDynamicProperty).toBe('function')
  })

  it('exports harness configuration factory and utilities', () => {
    expect(typeof core.defineHarness).toBe('function')
    expect(typeof core.validateHarnessConfig).toBe('function')
    expect(typeof core.isAgentRunner).toBe('function')
    expect(typeof core.HarnessConfigError).toBe('function')
  })

  it('does not export deprecated placeholder foo or bar', () => {
    expect((core as Record<string, unknown>).foo).toBeUndefined()
    expect((core as Record<string, unknown>).bar).toBeUndefined()
  })

  it('resolves dynamic property via index export', async () => {
    const ctx = {
      runId: 'r-1',
      environments: {},
      steps: {},
      step: { id: 's-1', output: null, attempt: 1 },
      matrix: undefined,
      artifacts: {},
    } satisfies StepContext
    const resolved = await core.resolveDynamicProperty((c: StepContext) => c.runId, ctx)
    expect(resolved).toBe('r-1')
  })
})
