import fs from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ZodError } from 'zod'
import { SchemaVersionMismatchError } from '../../errors/schema-version-mismatch-error.js'
import { readLedgerEvents } from '../ledger-writer.js'
import { SUPPORTED_SCHEMA_VERSION } from '../state-store.js'

let tempDir: string

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-ledger-schema-test-'))
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

function writeRawLedger(lines: unknown[]): string {
  const runDir = path.join(tempDir, 'run')
  fs.mkdirSync(runDir, { recursive: true })
  const ledgerFile = path.join(runDir, 'ledger.jsonl')
  const serialized = lines.map(item => JSON.stringify(item)).join('\n')
  fs.writeFileSync(ledgerFile, `${serialized}\n`, 'utf8')
  return runDir
}

describe('readLedgerEvents schema version validation (AC 2.3.1)', () => {
  it('throws SchemaVersionMismatchError on schemaVersion: 0', () => {
    const runDir = writeRawLedger([
      {
        schemaVersion: 0,
        timestamp: '2026-11-08T20:00:00.000Z',
        runId: 'r-0',
        stepId: null,
        eventType: 'run.started',
        payload: {},
      },
    ])

    const ledgerPath = path.join(runDir, 'ledger.jsonl')
    try {
      readLedgerEvents(runDir)
      expect.fail('Expected SchemaVersionMismatchError')
    }
    catch (err) {
      expect(err).toBeInstanceOf(SchemaVersionMismatchError)
      const mismatch = err as SchemaVersionMismatchError
      expect(mismatch.expectedVersion).toBe(SUPPORTED_SCHEMA_VERSION)
      expect(mismatch.actualVersion).toBe(0)
      expect(mismatch.sourcePath).toBe(ledgerPath)
    }
  })

  it('throws SchemaVersionMismatchError on schemaVersion: 2', () => {
    const runDir = writeRawLedger([
      {
        schemaVersion: 2,
        timestamp: '2026-11-08T20:00:00.000Z',
        runId: 'r-2',
        stepId: null,
        eventType: 'run.started',
        payload: {},
      },
    ])

    try {
      readLedgerEvents(runDir)
      expect.fail('Expected SchemaVersionMismatchError')
    }
    catch (err) {
      expect(err).toBeInstanceOf(SchemaVersionMismatchError)
      const mismatch = err as SchemaVersionMismatchError
      expect(mismatch.expectedVersion).toBe(1)
      expect(mismatch.actualVersion).toBe(2)
    }
  })
})

describe('readLedgerEvents non-number and non-object handling (AC 2.3.1)', () => {
  it('throws SchemaVersionMismatchError on non-number or missing schemaVersion', () => {
    const runDirString = writeRawLedger([
      {
        schemaVersion: '1',
        runId: 'r-1',
      },
    ])
    expect(() => readLedgerEvents(runDirString)).toThrow(SchemaVersionMismatchError)

    const runDirMissing = writeRawLedger([
      {
        runId: 'r-missing',
      },
    ])
    try {
      readLedgerEvents(runDirMissing)
      expect.fail('Expected SchemaVersionMismatchError')
    }
    catch (err) {
      expect(err).toBeInstanceOf(SchemaVersionMismatchError)
      const mismatch = err as SchemaVersionMismatchError
      expect(mismatch.actualVersion).toBeUndefined()
    }
  })

  it('throws SchemaVersionMismatchError on non-object JSON entries', () => {
    const runDirPrimitive = writeRawLedger(['not-an-object'])
    expect(() => readLedgerEvents(runDirPrimitive)).toThrow(SchemaVersionMismatchError)

    const runDirNull = writeRawLedger([null])
    expect(() => readLedgerEvents(runDirNull)).toThrow(SchemaVersionMismatchError)
  })
})

describe('readLedgerEvents structural validation (AC 2.3.3)', () => {
  it('throws ZodError on invalid event envelope or payload structure', () => {
    const runDirInvalidType = writeRawLedger([
      {
        schemaVersion: 1,
        timestamp: '2026-11-08T20:00:00.000Z',
        runId: 'r-1',
        stepId: null,
        eventType: 'unknown.event.type',
        payload: {},
      },
    ])
    expect(() => readLedgerEvents(runDirInvalidType)).toThrow(ZodError)

    const runDirInvalidPayload = writeRawLedger([
      {
        schemaVersion: 1,
        timestamp: '2026-11-08T20:00:00.000Z',
        runId: 'r-1',
        stepId: null,
        eventType: 'run.started',
        payload: 'not-a-record',
      },
    ])
    expect(() => readLedgerEvents(runDirInvalidPayload)).toThrow(ZodError)
  })
})
