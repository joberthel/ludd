import type {
  AgentStreamEvent,
  AgentStreamEventType,
  LedgerEvent,
  LedgerEventType,
  StepContext,
} from './index.js'
import { describe, expect, it } from 'vitest'
import * as core from './index.js'

describe('@ludd/core harness and configuration exports', () => {
  it('exports resolveDynamicProperty as a function', () => {
    expect(typeof core.resolveDynamicProperty).toBe('function')
  })

  it('exports harness configuration factory and utilities', () => {
    expect(typeof core.defineHarness).toBe('function')
    expect(typeof core.validateHarnessConfig).toBe('function')
    expect(typeof core.loadHarnessConfig).toBe('function')
    expect(typeof core.runHarness).toBe('function')
    expect(typeof core.isAgentRunner).toBe('function')
    expect(typeof core.executeAgentStep).toBe('function')
    expect(typeof core.createAgentStepOutput).toBe('function')
    expect(typeof core.validateStepOutput).toBe('function')
    expect(typeof core.HarnessConfigError).toBe('function')
    expect(typeof core.HarnessConfigLoadError).toBe('function')
    expect(typeof core.RunAlreadyActiveError).toBe('function')
    expect(typeof core.StepOutputValidationError).toBe('function')
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

describe('@ludd/core persistence and execution exports', () => {
  it('exports state store, pid lock, ledger, and stream persistence utilities', () => {
    expect(typeof core.resolveRunDir).toBe('function')
    expect(typeof core.writeRunStateAtomic).toBe('function')
    expect(typeof core.readRunState).toBe('function')
    expect(typeof core.appendLedgerEvent).toBe('function')
    expect(typeof core.readLedgerEvents).toBe('function')
    expect(typeof core.appendStreamEvent).toBe('function')
    expect(typeof core.readStreamEvents).toBe('function')
    expect(typeof core.resolveStreamPath).toBe('function')
    expect(typeof core.acquireRunPidLock).toBe('function')
    expect(typeof core.releaseRunPidLock).toBe('function')
    expect(typeof core.isProcessAlive).toBe('function')
    expect(core.SUPPORTED_SCHEMA_VERSION).toBe(1)
    expect(typeof core.SchemaVersionMismatchError).toBe('function')
  })

  it('exports typed stream structures', () => {
    const eventType: AgentStreamEventType = 'turn.started'
    const event: AgentStreamEvent<{ prompt: string }> = {
      schemaVersion: 1,
      timestamp: new Date().toISOString(),
      runId: 'r-1',
      stepId: 's-1',
      sessionId: 'sess-1',
      attempt: 1,
      eventType,
      payload: { prompt: 'hello' },
    }
    expect(event.schemaVersion).toBe(1)
    expect(event.eventType).toBe('turn.started')
    expect(event.payload.prompt).toBe('hello')
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
})
