import type { AgentStreamEvent } from '../types/stream.js'
import fs from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SchemaVersionMismatchError } from '../errors/schema-version-mismatch-error.js'
import {
  appendStreamEvent,
  readStreamEvents,
  resolveStreamPath,
} from './stream-writer.js'

describe('streamWriter resolveStreamPath', () => {
  it('resolves stream path under streams subdirectory with sessionId.jsonl', () => {
    const streamPath = resolveStreamPath('/tmp/test-run', 'sess-123')
    expect(streamPath).toBe(path.join('/tmp/test-run', 'streams', 'sess-123.jsonl'))
  })
})

describe('streamWriter appendStreamEvent and readStreamEvents', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-stream-test-'))
  })
  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('returns empty array when stream file does not exist', () => {
    const events = readStreamEvents(tempDir, 'non-existent-session')
    expect(events).toEqual([])
  })

  it('appends and reads valid stream events in chronological order', () => {
    const event1: AgentStreamEvent = {
      schemaVersion: 1,
      timestamp: new Date().toISOString(),
      runId: 'r-1',
      stepId: 's-1',
      sessionId: 'sess-abc',
      attempt: 1,
      eventType: 'turn.started',
      payload: { prompt: 'do work', mode: 'read-only' },
    }

    const event2: AgentStreamEvent = {
      schemaVersion: 1,
      timestamp: new Date().toISOString(),
      runId: 'r-1',
      stepId: 's-1',
      sessionId: 'sess-abc',
      attempt: 1,
      eventType: 'turn.completed',
      payload: { output: 'finished' },
    }

    appendStreamEvent(tempDir, 'sess-abc', event1)
    appendStreamEvent(tempDir, 'sess-abc', event2)

    const events = readStreamEvents(tempDir, 'sess-abc')
    expect(events).toHaveLength(2)
    expect(events[0]).toEqual(event1)
    expect(events[1]).toEqual(event2)
  })
})

describe('streamWriter validation and error handling (AC 3.3.4)', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-stream-err-'))
  })
  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('throws SchemaVersionMismatchError when entry has unsupported schemaVersion', () => {
    const streamPath = resolveStreamPath(tempDir, 'sess-ver')
    fs.mkdirSync(path.dirname(streamPath), { recursive: true })
    fs.writeFileSync(streamPath, `${JSON.stringify({ schemaVersion: 99 })}\n`)

    expect(() => readStreamEvents(tempDir, 'sess-ver')).toThrow(SchemaVersionMismatchError)
  })

  it('throws SchemaVersionMismatchError when entry is not an object', () => {
    const streamPath = resolveStreamPath(tempDir, 'sess-prim')
    fs.mkdirSync(path.dirname(streamPath), { recursive: true })
    fs.writeFileSync(streamPath, `"primitive-value"\n`)

    expect(() => readStreamEvents(tempDir, 'sess-prim')).toThrow(SchemaVersionMismatchError)
  })

  it('throws descriptive error on invalid JSON', () => {
    const streamPath = resolveStreamPath(tempDir, 'sess-bad-json')
    fs.mkdirSync(path.dirname(streamPath), { recursive: true })
    fs.writeFileSync(streamPath, `{ bad json line\n`)

    expect(() => readStreamEvents(tempDir, 'sess-bad-json')).toThrow('Failed to parse stream event')
  })
})
