import fs from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ZodError } from 'zod'
import { SchemaVersionMismatchError } from '../../errors/schema-version-mismatch-error.js'
import { readRunState, SUPPORTED_SCHEMA_VERSION } from '../state-store.js'

let tempDir: string

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-state-schema-test-'))
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

function writeRawState(content: unknown): string {
  const runDir = path.join(tempDir, 'run')
  fs.mkdirSync(runDir, { recursive: true })
  const stateFile = path.join(runDir, 'state.json')
  fs.writeFileSync(stateFile, JSON.stringify(content), 'utf-8')
  return runDir
}

describe('readRunState schema version numbers (AC 2.3.1)', () => {
  it('throws SchemaVersionMismatchError on schemaVersion: 0', () => {
    const runDir = writeRawState({
      schemaVersion: 0,
      runId: 'run-0',
      harnessName: 'test',
      workflowName: 'test',
      status: 'running',
      activeStepId: null,
      steps: {},
      updatedAt: '2026-11-08T20:00:00.000Z',
    })

    const statePath = path.join(runDir, 'state.json')
    expect(() => readRunState(runDir)).toThrow(SchemaVersionMismatchError)
    try {
      readRunState(runDir)
    }
    catch (err) {
      const mismatch = err as SchemaVersionMismatchError
      expect(mismatch.expectedVersion).toBe(SUPPORTED_SCHEMA_VERSION)
      expect(mismatch.actualVersion).toBe(0)
      expect(mismatch.sourcePath).toBe(statePath)
    }
  })

  it('throws SchemaVersionMismatchError on schemaVersion: 2', () => {
    const runDir = writeRawState({
      schemaVersion: 2,
      runId: 'run-2',
      harnessName: 'test',
      workflowName: 'test',
      status: 'running',
      activeStepId: null,
      steps: {},
      updatedAt: '2026-11-08T20:00:00.000Z',
    })

    const statePath = path.join(runDir, 'state.json')
    try {
      readRunState(runDir)
      expect.fail('Expected SchemaVersionMismatchError')
    }
    catch (err) {
      expect(err).toBeInstanceOf(SchemaVersionMismatchError)
      const mismatch = err as SchemaVersionMismatchError
      expect(mismatch.expectedVersion).toBe(1)
      expect(mismatch.actualVersion).toBe(2)
      expect(mismatch.sourcePath).toBe(statePath)
    }
  })
})

describe('readRunState non-number and missing schemaVersion (AC 2.3.1)', () => {
  it('throws SchemaVersionMismatchError on non-number or missing schemaVersion', () => {
    const runDirStringVer = writeRawState({
      schemaVersion: '1',
      runId: 'run-str',
    })
    expect(() => readRunState(runDirStringVer)).toThrow(SchemaVersionMismatchError)

    const runDirMissingVer = writeRawState({
      runId: 'run-missing',
    })
    try {
      readRunState(runDirMissingVer)
      expect.fail('Expected SchemaVersionMismatchError')
    }
    catch (err) {
      expect(err).toBeInstanceOf(SchemaVersionMismatchError)
      const mismatch = err as SchemaVersionMismatchError
      expect(mismatch.expectedVersion).toBe(1)
      expect(mismatch.actualVersion).toBeUndefined()
    }
  })

  it('throws SchemaVersionMismatchError on non-object JSON payloads', () => {
    const runDirPrimitive = writeRawState('primitive string')
    expect(() => readRunState(runDirPrimitive)).toThrow(SchemaVersionMismatchError)

    const runDirNull = writeRawState(null)
    expect(() => readRunState(runDirNull)).toThrow(SchemaVersionMismatchError)

    const runDirArray = writeRawState([
      1,
      2,
      3,
    ])
    expect(() => readRunState(runDirArray)).toThrow(SchemaVersionMismatchError)
  })
})

describe('readRunState structural validation (AC 2.3.3)', () => {
  it('throws ZodError when schemaVersion is 1 but payload structure is invalid', () => {
    const runDir = writeRawState({
      schemaVersion: 1,
      runId: 12345,
      harnessName: 'test',
      workflowName: 'test',
      status: 'invalid-status',
      activeStepId: 999,
      steps: {
        'step-1': {
          status: 'invalid-step-status',
        },
      },
      updatedAt: '2026-11-08T20:00:00.000Z',
    })

    expect(() => readRunState(runDir)).toThrow(ZodError)
  })

  it('accepts valid activeSessionId and activeStepAttempt properties', () => {
    const runDir = writeRawState({
      schemaVersion: 1,
      runId: 'run-active-sess',
      harnessName: 'test',
      workflowName: 'test',
      status: 'running',
      activeStepId: 'step-agent',
      activeSessionId: 'session-xyz',
      activeStepAttempt: 2,
      steps: {},
      updatedAt: '2026-11-08T20:00:00.000Z',
    })

    const parsed = readRunState(runDir)
    expect(parsed.activeSessionId).toBe('session-xyz')
    expect(parsed.activeStepAttempt).toBe(2)
  })
})

describe('readRunState workflow identity compatibility', () => {
  it('uses harnessName for workflowName when reading legacy snapshots', () => {
    const runDir = writeRawState({
      schemaVersion: 1,
      runId: 'legacy-run',
      harnessName: 'legacy-workflow',
      status: 'running',
      activeStepId: null,
      steps: {},
      updatedAt: '2026-11-08T20:00:00.000Z',
    })

    expect(readRunState(runDir).workflowName).toBe('legacy-workflow')
  })
})

describe('readRunState active matrix valid properties (AC 4.5.1 & AC 4.5.3)', () => {
  it('accepts valid activeMatrixIndex and activeMatrixOutputs properties', () => {
    const runDir = writeRawState({
      schemaVersion: 1,
      runId: 'run-active-matrix',
      harnessName: 'test',
      workflowName: 'test',
      status: 'running',
      activeStepId: 'step-matrix',
      activeMatrixIndex: 2,
      activeMatrixOutputs: [
        { foo: 'bar' },
        42,
      ],
      steps: {},
      updatedAt: '2026-11-08T20:00:00.000Z',
    })

    const parsed = readRunState(runDir)
    expect(parsed.activeMatrixIndex).toBe(2)
    expect(parsed.activeMatrixOutputs).toEqual([
      { foo: 'bar' },
      42,
    ])

    const runDirNull = writeRawState({
      schemaVersion: 1,
      runId: 'run-null-matrix',
      harnessName: 'test',
      workflowName: 'test',
      status: 'running',
      activeStepId: 'step-matrix',
      activeMatrixIndex: null,
      activeMatrixOutputs: [],
      steps: {},
      updatedAt: '2026-11-08T20:00:00.000Z',
    })
    const parsedNull = readRunState(runDirNull)
    expect(parsedNull.activeMatrixIndex).toBeNull()
    expect(parsedNull.activeMatrixOutputs).toEqual([])
  })
})

describe('readRunState active matrix validation errors (AC 4.5.1)', () => {
  it('throws ZodError on invalid activeMatrixIndex or activeMatrixOutputs', () => {
    const baseState = {
      schemaVersion: 1,
      runId: 'run-invalid-matrix',
      harnessName: 'test',
      workflowName: 'test',
      status: 'running',
      activeStepId: 'step-matrix',
      steps: {},
      updatedAt: '2026-11-08T20:00:00.000Z',
    }

    expect(() => readRunState(writeRawState({ ...baseState, activeMatrixIndex: -1 }))).toThrow(ZodError)
    expect(() => readRunState(writeRawState({ ...baseState, activeMatrixIndex: 1.5 }))).toThrow(ZodError)
    expect(() => readRunState(writeRawState({ ...baseState, activeMatrixOutputs: 'invalid' }))).toThrow(ZodError)
  })
})
