import type { LedgerEvent } from '../../types/ledger.js'
import fs from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { appendLedgerEvent } from '../ledger-writer.js'

let tempDir: string

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-ledger-append-test-'))
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

describe('appendLedgerEvent directory creation', () => {
  it('creates runDir recursively if it does not exist', () => {
    const nestedRunDir = path.join(tempDir, 'nested', 'runs', 'run-1')
    const event: LedgerEvent = {
      schemaVersion: 1,
      timestamp: new Date().toISOString(),
      runId: 'run-1',
      stepId: null,
      eventType: 'run.started',
      payload: { harnessName: 'test-harness' },
    }

    expect(fs.existsSync(nestedRunDir)).toBe(false)
    appendLedgerEvent(nestedRunDir, event)
    expect(fs.existsSync(nestedRunDir)).toBe(true)

    const ledgerFile = path.join(nestedRunDir, 'ledger.jsonl')
    expect(fs.existsSync(ledgerFile)).toBe(true)
    const content = fs.readFileSync(ledgerFile, 'utf8')
    expect(content.endsWith('\n')).toBe(true)
    expect(JSON.parse(content)).toEqual(event)
  })
})

describe('appendLedgerEvent sequential append', () => {
  it('appends multiple events sequentially to ledger.jsonl', () => {
    const runDir = path.join(tempDir, 'runs', 'run-seq')
    const event1: LedgerEvent = {
      schemaVersion: 1,
      timestamp: '2026-11-08T20:00:00.000Z',
      runId: 'run-seq',
      stepId: null,
      eventType: 'run.started',
      payload: { harnessName: 'seq-harness' },
    }
    const event2: LedgerEvent = {
      schemaVersion: 1,
      timestamp: '2026-11-08T20:00:01.000Z',
      runId: 'run-seq',
      stepId: 'step-1',
      eventType: 'step.started',
      payload: { attempt: 1 },
    }
    const event3: LedgerEvent = {
      schemaVersion: 1,
      timestamp: '2026-11-08T20:00:02.000Z',
      runId: 'run-seq',
      stepId: 'step-1',
      eventType: 'step.passed',
      payload: {
        output: { greeting: 'hällo wörld' },
      },
    }

    appendLedgerEvent(runDir, event1)
    appendLedgerEvent(runDir, event2)
    appendLedgerEvent(runDir, event3)

    const ledgerFile = path.join(runDir, 'ledger.jsonl')
    const rawContent = fs.readFileSync(ledgerFile, 'utf8')
    const lines = rawContent.trim().split('\n')
    expect(lines).toHaveLength(3)

    expect(JSON.parse(lines[0])).toEqual(event1)
    expect(JSON.parse(lines[1])).toEqual(event2)
    expect(JSON.parse(lines[2])).toEqual(event3)
  })
})
