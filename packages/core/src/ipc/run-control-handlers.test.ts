import type { RunStateSnapshot } from '../types/state.js'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { JsonRpcResponseError } from '../errors/json-rpc-response-error.js'
import { readLedgerEvents } from '../persistence/ledger-writer.js'
import { readRunState, writeRunStateAtomic } from '../persistence/state-store.js'
import { createGateWaiter } from '../runtime/gate-waiter.js'
import {
  createRunAbortHandler,
  createRunTeardownHandler,
  validateRunAbortParams,
  validateRunTeardownParams,
} from './run-control-handlers.js'

describe('validateRunAbortParams', () => {
  it('accepts undefined, null, or empty object', () => {
    expect(validateRunAbortParams(undefined)).toEqual({ reason: undefined, teardown: undefined })
    expect(validateRunAbortParams({})).toEqual({ reason: undefined, teardown: undefined })
  })

  it('accepts valid reason and teardown boolean', () => {
    expect(validateRunAbortParams({ reason: 'Stop now', teardown: true })).toEqual({
      reason: 'Stop now',
      teardown: true,
    })
  })

  it('rejects non-object params', () => {
    expect(() => validateRunAbortParams('invalid')).toThrow(JsonRpcResponseError)
    expect(() => validateRunAbortParams([1, 2, 3])).toThrow(JsonRpcResponseError)
  })

  it('rejects invalid reason or teardown types', () => {
    expect(() => validateRunAbortParams({ reason: 123 })).toThrow(JsonRpcResponseError)
    expect(() => validateRunAbortParams({ teardown: 'yes' })).toThrow(JsonRpcResponseError)
  })
})

describe('validateRunTeardownParams', () => {
  it('accepts undefined, empty object, or valid force flag', () => {
    expect(validateRunTeardownParams(undefined)).toEqual({ force: undefined })
    expect(validateRunTeardownParams({ force: true })).toEqual({ force: true })
    expect(validateRunTeardownParams({ force: false })).toEqual({ force: false })
  })

  it('rejects non-object params or non-boolean force', () => {
    expect(() => validateRunTeardownParams(null)).toThrow(JsonRpcResponseError)
    expect(() => validateRunTeardownParams({ force: 'true' })).toThrow(JsonRpcResponseError)
  })
})

function createSnapshot(runId: string): RunStateSnapshot {
  return {
    schemaVersion: 1,
    runId,
    harnessName: 'test-harness',
    workflowName: 'test-harness',
    status: 'running',
    activeStepId: 'step-1',
    steps: {},
    updatedAt: new Date().toISOString(),
  }
}

describe('createRunAbortHandler', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-abort-ctrl-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('aborts with default or explicit reason without invoking onTeardown directly', async () => {
    const snapshot = createSnapshot('abort-no-td')
    writeRunStateAtomic(tempDir, snapshot)

    const abortController = new AbortController()
    const gateWaiter = createGateWaiter(abortController.signal)
    const onTeardown = vi.fn().mockResolvedValue(true)

    const handler = createRunAbortHandler({
      runDir: tempDir,
      getSnapshot: () => snapshot,
      onTeardown,
      abortController,
      gateWaiter,
    })

    const result = await handler({ reason: 'Manual cancel' })
    expect(result.ok).toBe(true)
    expect(abortController.signal.aborted).toBe(true)
    expect(onTeardown).not.toHaveBeenCalled()
    expect(readRunState(tempDir).status).toBe('failed')

    const failedEvent = readLedgerEvents(tempDir).find(e => e.eventType === 'run.failed')
    expect(failedEvent?.payload.error).toBe('Manual cancel')
  })

  it('persists failed state before firing abortController.abort() and skips emitting run.teardown', async () => {
    const snapshot = createSnapshot('abort-order')
    writeRunStateAtomic(tempDir, snapshot)

    const abortController = new AbortController()
    const gateWaiter = createGateWaiter(abortController.signal)
    const events: string[] = []

    abortController.signal.addEventListener('abort', () => {
      expect(readRunState(tempDir).status).toBe('failed')
      expect(readRunState(tempDir).activeStepId).toBeNull()
      events.push('abort')
    })

    const handler = createRunAbortHandler({
      runDir: tempDir,
      getSnapshot: () => snapshot,
      abortController,
      gateWaiter,
    })

    const result = await handler({ teardown: true })
    expect(result.ok).toBe(true)
    expect(events).toEqual(['abort'])
    expect(readLedgerEvents(tempDir).some(e => e.eventType === 'run.teardown')).toBe(false)
    expect(readLedgerEvents(tempDir).find(e => e.eventType === 'run.failed')?.payload.error).toBe(
      'Run aborted by external control',
    )
  })
})

describe('createRunTeardownHandler', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-td-handler-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('records hookInvoked boolean from onTeardown and forced flag', async () => {
    const snapshot: RunStateSnapshot = {
      schemaVersion: 1,
      runId: 'td-hook-run',
      harnessName: 'test-harness',
      workflowName: 'test-harness',
      status: 'waiting_for_gate',
      activeStepId: 'step-1',
      steps: {},
      updatedAt: new Date().toISOString(),
    }
    writeRunStateAtomic(tempDir, snapshot)

    const onTeardown = vi.fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
    const handler = createRunTeardownHandler({
      runDir: tempDir,
      getSnapshot: () => snapshot,
      onTeardown,
      abortController: new AbortController(),
      gateWaiter: createGateWaiter(),
    })

    expect(await handler({ force: true })).toEqual({ ok: true })
    expect(await handler({})).toEqual({ ok: true })
    expect(onTeardown).toHaveBeenCalledTimes(2)

    const tdEvents = readLedgerEvents(tempDir).filter(e => e.eventType === 'run.teardown')
    expect(tdEvents.map(e => e.payload)).toEqual([
      { hookInvoked: true, forced: true },
      { hookInvoked: false, forced: false },
    ])
  })

  it('records hookInvoked false when onTeardown is omitted', async () => {
    const snapshot = createSnapshot('td-no-hook-run')
    writeRunStateAtomic(tempDir, snapshot)

    const handler = createRunTeardownHandler({
      runDir: tempDir,
      getSnapshot: () => snapshot,
      abortController: new AbortController(),
      gateWaiter: createGateWaiter(),
    })

    expect(await handler({})).toEqual({ ok: true })
    const tdEvent = readLedgerEvents(tempDir).find(e => e.eventType === 'run.teardown')
    expect(tdEvent?.payload).toEqual({ hookInvoked: false, forced: false })
  })
})
