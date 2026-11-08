import type { LedgerEvent, LedgerEventType, StepContext } from './index.js'
import { describe, expect, it } from 'vitest'
import * as core from './index.js'

describe('@ludd/core public exports contract', () => {
  it('exports resolveDynamicProperty as a function', () => {
    expect(typeof core.resolveDynamicProperty).toBe('function')
  })

  it('exports harness configuration factory and utilities', () => {
    expect(typeof core.defineHarness).toBe('function')
    expect(typeof core.validateHarnessConfig).toBe('function')
    expect(typeof core.loadHarnessConfig).toBe('function')
    expect(typeof core.runHarness).toBe('function')
    expect(typeof core.isAgentRunner).toBe('function')
    expect(typeof core.HarnessConfigError).toBe('function')
    expect(typeof core.HarnessConfigLoadError).toBe('function')
    expect(typeof core.StepOutputValidationError).toBe('function')
  })

  it('exports state store and ledger persistence utilities', () => {
    expect(typeof core.resolveRunDir).toBe('function')
    expect(typeof core.writeRunStateAtomic).toBe('function')
    expect(typeof core.appendLedgerEvent).toBe('function')
  })

  it('exports typed ledger structures', () => {
    const eventType: LedgerEventType = 'run.started'
    const event: LedgerEvent<{ test: boolean }> = {
      schemaVersion: 1,
      timestamp: new Date().toISOString(),
      runId: 'r-1',
      stepId: null,
      eventType,
      payload: { test: true },
    }
    expect(event.schemaVersion).toBe(1)
    expect(event.eventType).toBe('run.started')
    expect(event.payload.test).toBe(true)
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
