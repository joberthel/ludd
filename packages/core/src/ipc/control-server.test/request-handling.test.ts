import type { ControlRpcHandlers } from '../../types/ipc.js'
import type { RunStateSnapshot } from '../../types/state.js'
import { describe, expect, it } from 'vitest'
import {
  dispatchRpcRequest,
  handleRpcMessage,
  validateJsonRpcRequest,
} from '../control-server.js'

function createFakeSnapshot(status: 'running' | 'passed' = 'running'): RunStateSnapshot {
  return {
    schemaVersion: 1,
    runId: 'test-run-123',
    harnessName: 'test-harness',
    workflowName: 'test-harness',
    status,
    activeStepId: 'step-a',
    steps: {},
    updatedAt: new Date().toISOString(),
  }
}

describe('validateJsonRpcRequest invalid inputs', () => {
  it('rejects null, non-objects, and arrays as Invalid Request (-32600)', () => {
    expect(validateJsonRpcRequest(null).errorResponse?.error.code).toBe(-32600)
    expect(validateJsonRpcRequest('string').errorResponse?.error.code).toBe(-32600)
    expect(validateJsonRpcRequest(123).errorResponse?.error.code).toBe(-32600)
    expect(validateJsonRpcRequest([]).errorResponse?.error.code).toBe(-32600)
  })

  it('rejects missing or non-2.0 jsonrpc or invalid method as Invalid Request (-32600)', () => {
    expect(validateJsonRpcRequest({ jsonrpc: '1.0', method: 'foo', id: 1 }).errorResponse?.id).toBe(1)
    expect(validateJsonRpcRequest({ jsonrpc: '2.0', method: 123, id: 'req-1' }).errorResponse?.id).toBe('req-1')
  })

  it('rejects invalid id types as Invalid Request (-32600)', () => {
    expect(validateJsonRpcRequest({ jsonrpc: '2.0', method: 'foo', id: true }).errorResponse?.id).toBeNull()
  })

  it('rejects non-object params as Invalid params (-32602)', () => {
    const res = validateJsonRpcRequest({
      jsonrpc: '2.0',
      method: 'foo',
      id: 2,
      params: 'string-param',
    })
    expect(res.errorResponse?.error.code).toBe(-32602)
    expect(res.errorResponse?.id).toBe(2)
  })
})

describe('validateJsonRpcRequest valid inputs', () => {
  it('accepts valid request with object params or array params or omitted params', () => {
    expect(validateJsonRpcRequest({ jsonrpc: '2.0', method: 'm', id: 1 }).valid).toBe(true)
    expect(validateJsonRpcRequest({
      jsonrpc: '2.0',
      method: 'm',
      id: 1,
      params: { a: 1 },
    }).valid).toBe(true)
    expect(validateJsonRpcRequest({
      jsonrpc: '2.0',
      method: 'm',
      id: 1,
      params: [1, 2],
    }).valid).toBe(true)
    expect(validateJsonRpcRequest({ jsonrpc: '2.0', method: 'm' }).valid).toBe(true)
  })
})

describe('dispatchRpcRequest parser and validation errors', () => {
  it('returns parse error (-32700) for malformed JSON lines', async () => {
    const handlers: ControlRpcHandlers = {
      getStatus: () => createFakeSnapshot(),
    }
    const res = await handleRpcMessage('{ bad json \n', handlers)
    expect(res?.error?.code).toBe(-32700)
    expect(res?.id).toBeNull()
  })

  it('returns invalid request (-32600) via handleRpcMessage when JSON is valid but request is invalid', async () => {
    const handlers: ControlRpcHandlers = {
      getStatus: () => createFakeSnapshot(),
    }
    const res = await handleRpcMessage('{"not":"jsonrpc"}\n', handlers)
    expect(res?.error?.code).toBe(-32600)
  })
})

describe('dispatchRpcRequest core methods', () => {
  it('dispatches run.status returning snapshot', async () => {
    const handlers: ControlRpcHandlers = {
      getStatus: () => createFakeSnapshot('passed'),
    }
    const res = await handleRpcMessage(JSON.stringify({
      jsonrpc: '2.0',
      id: 10,
      method: 'run.status',
    }), handlers)
    expect(res).toEqual({
      jsonrpc: '2.0',
      id: 10,
      result: expect.objectContaining({ status: 'passed' }),
    })
  })

  it('dispatches gate.resolve, run.abort, and run.teardown when registered', async () => {
    const handlers: ControlRpcHandlers = {
      getStatus: () => createFakeSnapshot(),
      resolveGate: () => ({ ok: true }),
      abort: () => ({ ok: true }),
      teardown: () => ({ ok: true }),
    }
    const gateRes = await handleRpcMessage(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'gate.resolve' }), handlers)
    expect(gateRes?.result).toEqual({ ok: true })

    const abortRes = await handleRpcMessage(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'run.abort' }), handlers)
    expect(abortRes?.result).toEqual({ ok: true })

    const tdRes = await handleRpcMessage(JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'run.teardown' }), handlers)
    expect(tdRes?.result).toEqual({ ok: true })
  })
})

describe('dispatchRpcRequest custom and missing methods', () => {
  it('dispatches custom method if registered in handlers', async () => {
    const handlers: ControlRpcHandlers = {
      getStatus: () => createFakeSnapshot(),
      echo: params => ({ echoed: params }),
    }
    const res = await handleRpcMessage(JSON.stringify({
      jsonrpc: '2.0',
      id: 20,
      method: 'echo',
      params: { msg: 'hi' },
    }), handlers)
    expect(res).toEqual({
      jsonrpc: '2.0',
      id: 20,
      result: {
        echoed: { msg: 'hi' },
      },
    })
  })

  it('returns method not found (-32601) for unregistered methods', async () => {
    const handlers: ControlRpcHandlers = {
      getStatus: () => createFakeSnapshot(),
    }
    const res = await handleRpcMessage(JSON.stringify({
      jsonrpc: '2.0',
      id: 30,
      method: 'unknown.op',
    }), handlers)
    expect(res?.error?.code).toBe(-32601)
    expect(res?.id).toBe(30)
  })
})

describe('dispatchRpcRequest error handling', () => {
  it('returns internal error (-32603) when handler throws an Error instance', async () => {
    const handlers: ControlRpcHandlers = {
      getStatus: () => {
        throw new Error('snapshot failed')
      },
    }
    const res = await handleRpcMessage(JSON.stringify({
      jsonrpc: '2.0',
      id: 40,
      method: 'run.status',
    }), handlers)
    expect(res?.error?.code).toBe(-32603)
    expect(res?.error?.message).toBe('snapshot failed')
  })

  it('returns internal error (-32603) with fallback message when handler throws a non-Error', async () => {
    const handlers: ControlRpcHandlers = {
      // eslint-disable-next-line prefer-promise-reject-errors
      getStatus: async () => Promise.reject('raw-string-failure'),
    }
    const res = await handleRpcMessage(JSON.stringify({
      jsonrpc: '2.0',
      id: 41,
      method: 'run.status',
    }), handlers)
    expect(res?.error?.code).toBe(-32603)
    expect(res?.error?.message).toBe('Internal error')
  })
})

describe('dispatchRpcRequest notification handling', () => {
  it('suppresses responses for notifications without id', async () => {
    let called = false
    const handlers: ControlRpcHandlers = {
      getStatus: () => createFakeSnapshot(),
      notify: () => {
        called = true
      },
    }
    const res = await dispatchRpcRequest({ jsonrpc: '2.0', method: 'notify' }, handlers)
    expect(res).toBeNull()
    expect(called).toBe(true)

    const unknownRes = await dispatchRpcRequest({ jsonrpc: '2.0', method: 'missing' }, handlers)
    expect(unknownRes).toBeNull()

    const failingRes = await dispatchRpcRequest({
      jsonrpc: '2.0',
      method: 'notify',
    }, {
      getStatus: () => createFakeSnapshot(),
      notify: () => {
        throw new Error('silent fail')
      },
    })
    expect(failingRes).toBeNull()
  })
})
