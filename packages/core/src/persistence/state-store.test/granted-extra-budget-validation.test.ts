import fs from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ZodError } from 'zod'
import { readRunState } from '../state-store.js'

let tempDir: string

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-budget-schema-test-'))
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

describe('readRunState valid granted extra budget', () => {
  it('accepts valid grantedExtraRetries and grantedExtraTurns', () => {
    const runDir = writeRawState({
      schemaVersion: 1,
      runId: 'run-budget',
      harnessName: 'test',
      workflowName: 'test',
      status: 'running',
      activeStepId: 'step-1',
      grantedExtraRetries: {
        'step-1:0': 2,
        'step-2:1': 0,
      },
      grantedExtraTurns: {
        'step-1': 2,
        'step-2': 0,
      },
      steps: {},
      updatedAt: '2026-11-09T20:00:00.000Z',
    })

    const parsed = readRunState(runDir)
    expect(parsed.grantedExtraRetries).toEqual({
      'step-1:0': 2,
      'step-2:1': 0,
    })
    expect(parsed.grantedExtraTurns).toEqual({
      'step-1': 2,
      'step-2': 0,
    })
  })
})

describe('readRunState invalid granted extra budget', () => {
  it('rejects negative or non-integer numbers in grantedExtraRetries', () => {
    const base = {
      schemaVersion: 1,
      runId: 'run-invalid-retries',
      harnessName: 'test',
      workflowName: 'test',
      status: 'running',
      activeStepId: null,
      steps: {},
      updatedAt: '2026-11-09T20:00:00.000Z',
    }

    expect(() => readRunState(writeRawState({
      ...base,
      grantedExtraRetries: { 'step-1:0': -1 },
    }))).toThrow(ZodError)

    expect(() => readRunState(writeRawState({
      ...base,
      grantedExtraRetries: { 'step-1:0': 1.5 },
    }))).toThrow(ZodError)
  })

  it('rejects negative or non-integer numbers in grantedExtraTurns', () => {
    const base = {
      schemaVersion: 1,
      runId: 'run-invalid-turns',
      harnessName: 'test',
      workflowName: 'test',
      status: 'running',
      activeStepId: null,
      steps: {},
      updatedAt: '2026-11-09T20:00:00.000Z',
    }

    expect(() => readRunState(writeRawState({
      ...base,
      grantedExtraTurns: { 'step-1': -2 },
    }))).toThrow(ZodError)

    expect(() => readRunState(writeRawState({
      ...base,
      grantedExtraTurns: { 'step-1': 3.14 },
    }))).toThrow(ZodError)
  })
})
