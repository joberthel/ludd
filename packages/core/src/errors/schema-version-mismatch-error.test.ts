import { describe, expect, it } from 'vitest'
import { SchemaVersionMismatchError } from './schema-version-mismatch-error.js'

describe('schemaVersionMismatchError', () => {
  it('instantiates with expected properties and default message', () => {
    const error = new SchemaVersionMismatchError(1, 2, '/path/to/state.json')

    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('SchemaVersionMismatchError')
    expect(error.expectedVersion).toBe(1)
    expect(error.actualVersion).toBe(2)
    expect(error.sourcePath).toBe('/path/to/state.json')
    expect(error.message).toBe(
      'Schema version mismatch in "/path/to/state.json": expected version 1, but found 2.',
    )
  })

  it('formats undefined actualVersion gracefully', () => {
    const error = new SchemaVersionMismatchError(1, undefined, '/path/to/ledger.jsonl')

    expect(error.actualVersion).toBeUndefined()
    expect(error.message).toBe(
      'Schema version mismatch in "/path/to/ledger.jsonl": expected version 1, but found undefined.',
    )
  })

  it('formats non-number actualVersion objects or strings using JSON.stringify', () => {
    const errorString = new SchemaVersionMismatchError(1, '2', '/path/to/state.json')
    expect(errorString.message).toContain('found "2"')

    const errorNull = new SchemaVersionMismatchError(1, null, '/path/to/state.json')
    expect(errorNull.message).toContain('found null')

    const errorObj = new SchemaVersionMismatchError(1, { ver: 1 }, '/path/to/state.json')
    expect(errorObj.message).toContain('found {"ver":1}')
  })

  it('uses custom message when provided', () => {
    const customMessage = 'Custom version error override'
    const error = new SchemaVersionMismatchError(
      1,
      0,
      '/path/to/state.json',
      customMessage,
    )

    expect(error.message).toBe(customMessage)
    expect(error.expectedVersion).toBe(1)
    expect(error.actualVersion).toBe(0)
    expect(error.sourcePath).toBe('/path/to/state.json')
  })
})
