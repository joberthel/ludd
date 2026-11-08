import type { LedgerEvent } from '../../types/ledger.js'
import fs from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runHarness } from '../../runtime/run-harness.js'
import { appendLedgerEvent, readLedgerEvents } from '../ledger-writer.js'
import { resolveRunDir } from '../state-store.js'

let tempDir: string

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-read-ledger-test-'))
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

describe('readLedgerEvents appendLedgerEvent round-trip', () => {
  it('reads and losslessly round-trips events appended by appendLedgerEvent (AC 2.3.2)', () => {
    const runDir = path.join(tempDir, 'run-ledger-roundtrip')
    const events: LedgerEvent[] = [
      {
        schemaVersion: 1,
        timestamp: '2026-11-08T20:10:00.000Z',
        runId: 'run-ledger-roundtrip',
        stepId: null,
        eventType: 'run.started',
        payload: { harnessName: 'test-harness' },
      },

      {
        schemaVersion: 1,
        timestamp: '2026-11-08T20:10:01.000Z',
        runId: 'run-ledger-roundtrip',
        stepId: 'step-init',
        eventType: 'step.started',
        payload: { attempt: 1 },
      },

      {
        schemaVersion: 1,
        timestamp: '2026-11-08T20:10:02.000Z',
        runId: 'run-ledger-roundtrip',
        stepId: 'step-init',
        eventType: 'step.passed',
        payload: {
          output: {
            ready: true,
          },
        },
      },

      {
        schemaVersion: 1,
        timestamp: '2026-11-08T20:10:03.000Z',
        runId: 'run-ledger-roundtrip',
        stepId: null,
        eventType: 'run.passed',
        payload: {},
      },
    ]

    for (const event of events) {
      appendLedgerEvent(runDir, event)
    }

    const read = readLedgerEvents(runDir)
    expect(read).toEqual(events)
  })
})

describe('readLedgerEvents runHarness ledger emission', () => {
  it('cleanly reads ledger.jsonl emitted during runHarness() (AC 2.3.2)', async () => {
    const runId = 'run-harness-ledger-test'
    const config = {
      name: 'harness-ledger',
      steps: [
        {
          id: 'step-1',
          run: async () => ({ value: 123 }),
        },
      ],
    }

    await runHarness(config, { runId, workspaceDir: tempDir })
    const runDir = resolveRunDir(tempDir, runId)
    const events = readLedgerEvents(runDir)

    expect(events.length).toBeGreaterThanOrEqual(4)
    expect(events.every(e => e.schemaVersion === 1)).toBe(true)
    expect(events.map(e => e.eventType)).toEqual([
      'run.started',
      'step.started',
      'step.passed',
      'run.passed',
    ])
  })
})

describe('readLedgerEvents whitespace and error handling', () => {
  it('skips empty and whitespace-only lines', () => {
    const runDir = path.join(tempDir, 'run-with-blanks')
    fs.mkdirSync(runDir, { recursive: true })
    const ledgerFile = path.join(runDir, 'ledger.jsonl')
    const event: LedgerEvent = {
      schemaVersion: 1,
      timestamp: '2026-11-08T20:00:00.000Z',
      runId: 'run-blanks',
      stepId: null,
      eventType: 'run.started',
      payload: {},
    }

    const content = `\n\n  \n${JSON.stringify(event)}\n\n   \t\n`
    fs.writeFileSync(ledgerFile, content, 'utf8')

    const read = readLedgerEvents(runDir)
    expect(read).toEqual([event])
  })

  it('returns empty array when ledger file contains only whitespace or is empty', () => {
    const runDir = path.join(tempDir, 'empty-run')
    fs.mkdirSync(runDir, { recursive: true })
    fs.writeFileSync(path.join(runDir, 'ledger.jsonl'), '   \n\n  \t  \n', 'utf8')

    const read = readLedgerEvents(runDir)
    expect(read).toEqual([])
  })

  it('throws when ledger.jsonl does not exist', () => {
    const nonExistentDir = path.join(tempDir, 'no-ledger')
    expect(() => readLedgerEvents(nonExistentDir)).toThrow()
  })

  it('throws SyntaxError when a line has invalid JSON syntax', () => {
    const runDir = path.join(tempDir, 'corrupt-line')
    fs.mkdirSync(runDir, { recursive: true })
    fs.writeFileSync(path.join(runDir, 'ledger.jsonl'), 'not valid json {\n', 'utf8')

    expect(() => readLedgerEvents(runDir)).toThrow(SyntaxError)
  })
})
