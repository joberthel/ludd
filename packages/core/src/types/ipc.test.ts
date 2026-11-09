import { describe, expect, it } from 'vitest'
import {
  JSON_RPC_ERRORS,
  JSON_RPC_INTERNAL_ERROR,
  JSON_RPC_INVALID_PARAMS,
  JSON_RPC_INVALID_REQUEST,
  JSON_RPC_METHOD_NOT_FOUND,
  JSON_RPC_PARSE_ERROR,
} from './ipc.js'

describe('json-rpc error code constants', () => {
  it('exports standard JSON-RPC 2.0 error codes', () => {
    expect(JSON_RPC_PARSE_ERROR).toBe(-32700)
    expect(JSON_RPC_INVALID_REQUEST).toBe(-32600)
    expect(JSON_RPC_METHOD_NOT_FOUND).toBe(-32601)
    expect(JSON_RPC_INVALID_PARAMS).toBe(-32602)
    expect(JSON_RPC_INTERNAL_ERROR).toBe(-32603)
  })

  it('aggregates standard error codes in JSON_RPC_ERRORS dictionary', () => {
    expect(JSON_RPC_ERRORS.PARSE_ERROR).toBe(-32700)
    expect(JSON_RPC_ERRORS.INVALID_REQUEST).toBe(-32600)
    expect(JSON_RPC_ERRORS.METHOD_NOT_FOUND).toBe(-32601)
    expect(JSON_RPC_ERRORS.INVALID_PARAMS).toBe(-32602)
    expect(JSON_RPC_ERRORS.INTERNAL_ERROR).toBe(-32603)
  })
})
