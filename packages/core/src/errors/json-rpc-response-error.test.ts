import { describe, expect, it } from 'vitest'
import { JsonRpcResponseError } from './json-rpc-response-error.js'

describe('jsonRpcResponseError instantiation', () => {
  it('instantiates with code, message, and optional data', () => {
    const error = new JsonRpcResponseError(-32601, 'Method not found', { extra: 'detail' })

    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('JsonRpcResponseError')
    expect(error.message).toBe('Method not found')
    expect(error.code).toBe(-32601)
    expect(error.data).toEqual({ extra: 'detail' })
  })

  it('supports instantiating without data', () => {
    const error = new JsonRpcResponseError(-32700, 'Parse error')

    expect(error.code).toBe(-32700)
    expect(error.message).toBe('Parse error')
    expect(error.data).toBeUndefined()
  })
})
