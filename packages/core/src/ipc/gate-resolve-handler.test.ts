import type { RunStateSnapshot } from '../types/state.js'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { JsonRpcResponseError } from '../errors/json-rpc-response-error.js'
import { readLedgerEvents } from '../persistence/ledger-writer.js'
import { readRunState, writeRunStateAtomic } from '../persistence/state-store.js'
import { createGateWaiter } from '../runtime/gate-waiter.js'
import { JSON_RPC_INVALID_PARAMS } from '../types/ipc.js'
import { createGateResolveHandler, validateGateResolveParams } from './gate-resolve-handler.js'

function createSampleSnapshot(): RunStateSnapshot {
  return {
    schemaVersion: 1,
    runId: 'run-gate-test',
    harnessName: 'test-harness',
    workflowName: 'test-harness',
    status: 'waiting_for_gate',
    activeStepId: 'step-1',
    activeGate: {
      stepId: 'step-1',
      phase: 'beforeStep',
      guardrailIndex: 0,
      gateType: 'human_review',
      prompt: 'Please review',
      createdAt: new Date().toISOString(),
    },
    steps: {},
    updatedAt: new Date().toISOString(),
  }
}

let tempDir: string
let snapshot: RunStateSnapshot

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-gate-resolve-test-'))
  snapshot = createSampleSnapshot()
  writeRunStateAtomic(tempDir, snapshot)
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

describe('validateGateResolveParams invalid inputs', () => {
  it('throws on non-object inputs', () => {
    expect(() => validateGateResolveParams(null)).toThrow(JsonRpcResponseError)
    expect(() => validateGateResolveParams('string')).toThrow(JsonRpcResponseError)
    expect(() => validateGateResolveParams([1, 2])).toThrow(JsonRpcResponseError)
  })

  it('throws on missing or invalid stepId', () => {
    expect(() => validateGateResolveParams({ action: 'pass' })).toThrow(JsonRpcResponseError)
    expect(() => validateGateResolveParams({ stepId: '   ', action: 'pass' })).toThrow(JsonRpcResponseError)
  })

  it('throws on invalid action', () => {
    expect(() => validateGateResolveParams({ stepId: 's1', action: 'invalid' })).toThrow(JsonRpcResponseError)
  })

  it('throws on invalid optional fields', () => {
    expect(() => validateGateResolveParams({ stepId: 's1', action: 'pass', guardrailIndex: -1 })).toThrow(
      JsonRpcResponseError,
    )
    expect(() => validateGateResolveParams({ stepId: 's1', action: 'pass', guardrailIndex: 1.5 })).toThrow(
      JsonRpcResponseError,
    )
    expect(() => validateGateResolveParams({ stepId: 's1', action: 'pass', feedback: 123 })).toThrow(
      JsonRpcResponseError,
    )
    expect(() => validateGateResolveParams({ stepId: 's1', action: 'pass', addRetries: -5 })).toThrow(
      JsonRpcResponseError,
    )
    expect(() => validateGateResolveParams({ stepId: 's1', action: 'pass', addRetries: 2.3 })).toThrow(
      JsonRpcResponseError,
    )
  })
})

describe('validateGateResolveParams valid input', () => {
  it('parses and trims valid parameters', () => {
    const valid = validateGateResolveParams({
      stepId: ' step-1 ',
      action: 'pass',
      guardrailIndex: 2,
      feedback: 'Good work',
      addRetries: 3,
    })
    expect(valid).toEqual({
      stepId: 'step-1',
      action: 'pass',
      guardrailIndex: 2,
      feedback: 'Good work',
      addRetries: 3,
    })
  })
})

describe('createGateResolveHandler validation rules', () => {
  it('rejects when run status is not waiting_for_gate or activeGate is null', async () => {
    const waiter = createGateWaiter()
    const handler = createGateResolveHandler({
      runDir: tempDir,
      getSnapshot: () => snapshot,
      gateWaiter: waiter,
    })

    snapshot.status = 'running'
    await expect(handler({ stepId: 'step-1', action: 'pass' })).rejects.toMatchObject({
      code: JSON_RPC_INVALID_PARAMS,
    })

    snapshot.status = 'waiting_for_gate'
    snapshot.activeGate = null
    await expect(handler({ stepId: 'step-1', action: 'pass' })).rejects.toMatchObject({
      code: JSON_RPC_INVALID_PARAMS,
    })
  })

  it('rejects when stepId does not match activeGate stepId', async () => {
    const waiter = createGateWaiter()
    const handler = createGateResolveHandler({
      runDir: tempDir,
      getSnapshot: () => snapshot,
      gateWaiter: waiter,
    })

    await expect(handler({ stepId: 'step-mismatch', action: 'pass' })).rejects.toMatchObject({
      code: JSON_RPC_INVALID_PARAMS,
      message: expect.stringContaining('does not match requested'),
    })
  })

  it('rejects when guardrailIndex is supplied and does not match activeGate', async () => {
    const waiter = createGateWaiter()
    const handler = createGateResolveHandler({
      runDir: tempDir,
      getSnapshot: () => snapshot,
      gateWaiter: waiter,
    })

    await expect(handler({ stepId: 'step-1', guardrailIndex: 5, action: 'pass' })).rejects.toMatchObject({
      code: JSON_RPC_INVALID_PARAMS,
      message: expect.stringContaining('Active gate guardrailIndex 0 does not match requested 5'),
    })
  })
})

describe('createGateResolveHandler full resolution', () => {
  it('successfully resolves gate, writes ledger event, updates state, and resolves waiter', async () => {
    const waiter = createGateWaiter()
    const resolveSpy = vi.spyOn(waiter, 'resolve')
    const handler = createGateResolveHandler({
      runDir: tempDir,
      getSnapshot: () => snapshot,
      gateWaiter: waiter,
    })

    const result = await handler({
      stepId: 'step-1',
      guardrailIndex: 0,
      action: 'pass',
      feedback: 'Approved by human reviewer',
      addRetries: 2,
    })

    expect(result).toEqual({ ok: true })
    expect(resolveSpy).toHaveBeenCalledWith({
      stepId: 'step-1',
      guardrailIndex: 0,
      action: 'pass',
      feedback: 'Approved by human reviewer',
      addRetries: 2,
    })

    const updatedState = readRunState(tempDir)
    expect(updatedState.status).toBe('running')
    expect(updatedState.activeGate).toBeNull()

    const events = readLedgerEvents(tempDir)
    expect(events).toHaveLength(1)
    expect(events[0]?.eventType).toBe('gate.resolved')
    expect(events[0]?.payload).toEqual({
      stepId: 'step-1',
      guardrailIndex: 0,
      action: 'pass',
      feedback: 'Approved by human reviewer',
      addRetries: 2,
    })
  })
})

describe('createGateResolveHandler minimal resolution', () => {
  it('resolves gate without feedback or addRetries', async () => {
    const waiter = createGateWaiter()
    const handler = createGateResolveHandler({
      runDir: tempDir,
      getSnapshot: () => snapshot,
      gateWaiter: waiter,
    })

    const result = await handler({
      stepId: 'step-1',
      action: 'skip',
    })

    expect(result).toEqual({ ok: true })
    const events = readLedgerEvents(tempDir)
    expect(events).toHaveLength(1)
    expect(events[0]?.payload).toEqual({
      stepId: 'step-1',
      guardrailIndex: 0,
      action: 'skip',
    })
  })
})
