import fs from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ZodError } from 'zod'
import { appendLedgerEvent, readLedgerEvents } from '../ledger-writer.js'

let tempDir: string

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-ledger-matrix-index-test-'))
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

function writeRaw(line: unknown): string {
  const runDir = path.join(tempDir, 'run')
  fs.mkdirSync(runDir, { recursive: true })
  const ledgerFile = path.join(runDir, 'ledger.jsonl')
  fs.writeFileSync(ledgerFile, `${JSON.stringify(line)}\n`, 'utf8')
  return runDir
}

describe('ledgerEvent matrixIndex serialization', () => {
  it('serializes and parses valid non-negative integer matrixIndex', () => {
    const runDir = path.join(tempDir, 'run-1')
    appendLedgerEvent(runDir, {
      schemaVersion: 1,
      timestamp: '2026-11-08T20:00:00.000Z',
      runId: 'r-1',
      stepId: 'step-1',
      matrixIndex: 0,
      eventType: 'agent.stream.linked',
      payload: { sessionId: 's-1' },
    })
    appendLedgerEvent(runDir, {
      schemaVersion: 1,
      timestamp: '2026-11-08T20:00:01.000Z',
      runId: 'r-1',
      stepId: 'step-1',
      matrixIndex: 3,
      eventType: 'step.retry',
      payload: { attempt: 2 },
    })

    const events = readLedgerEvents(runDir)
    expect(events).toHaveLength(2)
    expect(events[0].matrixIndex).toBe(0)
    expect(events[1].matrixIndex).toBe(3)
  })

  it('allows omitted matrixIndex for non-matrix events', () => {
    const runDir = path.join(tempDir, 'run-2')
    appendLedgerEvent(runDir, {
      schemaVersion: 1,
      timestamp: '2026-11-08T20:00:00.000Z',
      runId: 'r-2',
      stepId: null,
      eventType: 'run.started',
      payload: {},
    })

    const events = readLedgerEvents(runDir)
    expect(events).toHaveLength(1)
    expect(events[0].matrixIndex).toBeUndefined()
  })
})

describe('ledgerEvent matrixIndex validation', () => {
  it('rejects negative, non-integer, and non-number matrixIndex values', () => {
    const runDirNegative = writeRaw({
      schemaVersion: 1,
      timestamp: '2026-11-08T20:00:00.000Z',
      runId: 'r-3',
      stepId: 'step-1',
      matrixIndex: -1,
      eventType: 'step.retry',
      payload: {},
    })
    expect(() => readLedgerEvents(runDirNegative)).toThrow(ZodError)

    const runDirFloat = writeRaw({
      schemaVersion: 1,
      timestamp: '2026-11-08T20:00:00.000Z',
      runId: 'r-4',
      stepId: 'step-1',
      matrixIndex: 1.5,
      eventType: 'step.retry',
      payload: {},
    })
    expect(() => readLedgerEvents(runDirFloat)).toThrow(ZodError)

    const runDirString = writeRaw({
      schemaVersion: 1,
      timestamp: '2026-11-08T20:00:00.000Z',
      runId: 'r-5',
      stepId: 'step-1',
      matrixIndex: '0',
      eventType: 'step.retry',
      payload: {},
    })
    expect(() => readLedgerEvents(runDirString)).toThrow(ZodError)
  })
})
