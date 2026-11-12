import type { ProvisionedEnvironment } from '../types/environment.js'
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

function createMockEnv(workingDir: string) {
  const teardown = vi.fn().mockResolvedValue(undefined)
  const mockEnv: ProvisionedEnvironment = {
    __kind: 'environment',
    id: 'e1',
    type: 'host',
    workingDir,
    exec: vi.fn(),
    ping: vi.fn(),
    teardown,
  }
  return { mockEnv, teardown }
}

function createSnapshot(runId: string, workingDir: string): RunStateSnapshot {
  return {
    schemaVersion: 1,
    runId,
    harnessName: 'test-harness',
    workflowName: 'test-harness',
    status: 'running',
    activeStepId: 'step-1',
    environments: {
      e1: { id: 'e1', type: 'host', workingDir },
    },
    steps: {},
    updatedAt: new Date().toISOString(),
  }
}

describe('createRunAbortHandler without teardown', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-abort-no-td-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('aborts without teardown when teardown flag is omitted', async () => {
    const snapshot = createSnapshot('abort-no-td', tempDir)
    writeRunStateAtomic(tempDir, snapshot)

    const abortController = new AbortController()
    const gateWaiter = createGateWaiter(abortController.signal)
    const { mockEnv, teardown } = createMockEnv(tempDir)

    const handler = createRunAbortHandler({
      runDir: tempDir,
      getSnapshot: () => snapshot,
      getEnvironments: () => ({ e1: mockEnv }),
      abortController,
      gateWaiter,
    })

    const result = await handler({ reason: 'Manual cancel' })
    expect(result.ok).toBe(true)
    expect(abortController.signal.aborted).toBe(true)
    expect(teardown).not.toHaveBeenCalled()
    expect(readRunState(tempDir).status).toBe('failed')

    const failedEvent = readLedgerEvents(tempDir).find(e => e.eventType === 'run.failed')
    expect(failedEvent?.payload.error).toBe('Manual cancel')
  })
})

describe('createRunAbortHandler with teardown', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-abort-td-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('aborts and tears down environments when teardown is true', async () => {
    const snapshot = createSnapshot('abort-with-td', tempDir)
    writeRunStateAtomic(tempDir, snapshot)

    const abortController = new AbortController()
    const gateWaiter = createGateWaiter(abortController.signal)
    const { mockEnv, teardown } = createMockEnv(tempDir)

    const handler = createRunAbortHandler({
      runDir: tempDir,
      getSnapshot: () => snapshot,
      getEnvironments: () => ({ e1: mockEnv }),
      abortController,
      gateWaiter,
    })

    const result = await handler({ teardown: true })
    expect(result.ok).toBe(true)
    expect(teardown).toHaveBeenCalled()
    expect(readRunState(tempDir).environments).toEqual({})
    expect(readLedgerEvents(tempDir).some(e => e.eventType === 'run.teardown')).toBe(true)
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

  it('invokes teardown on provisioned environments and emits ledger event', async () => {
    const snapshot = createSnapshot('td-handler-run', tempDir)
    writeRunStateAtomic(tempDir, snapshot)

    const { mockEnv, teardown } = createMockEnv(tempDir)
    const handler = createRunTeardownHandler({
      runDir: tempDir,
      getSnapshot: () => snapshot,
      getEnvironments: () => ({ e1: mockEnv }),
      abortController: new AbortController(),
      gateWaiter: createGateWaiter(),
    })

    const result = await handler({ force: true })
    expect(result.ok).toBe(true)
    expect(teardown).toHaveBeenCalledTimes(1)
    expect(readRunState(tempDir).environments).toEqual({})

    const tdEvent = readLedgerEvents(tempDir).find(e => e.eventType === 'run.teardown')
    expect(tdEvent?.payload.forced).toBe(true)
    expect(tdEvent?.payload.environments).toEqual(['e1'])
  })
})
