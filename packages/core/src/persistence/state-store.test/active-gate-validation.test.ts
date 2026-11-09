import fs from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ZodError } from 'zod'
import { readRunState } from '../state-store.js'

let tempDir: string

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-active-gate-test-'))
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

function writeRawState(dir: string, content: unknown): string {
  const runDir = path.join(dir, 'run')
  fs.mkdirSync(runDir, { recursive: true })
  const stateFile = path.join(runDir, 'state.json')
  fs.writeFileSync(stateFile, JSON.stringify(content), 'utf-8')
  return runDir
}

describe('readRunState activeGate valid states', () => {
  it('accepts waiting_for_gate status and valid activeGate object', () => {
    const runDir = writeRawState(tempDir, {
      schemaVersion: 1,
      runId: 'run-gate',
      harnessName: 'test',
      status: 'waiting_for_gate',
      activeStepId: 'step-clarify',
      activeGate: {
        stepId: 'step-clarify',
        matrixIndex: 0,
        phase: 'beforeStep',
        guardrailIndex: 0,
        gateType: 'human_review',
        prompt: 'Please enter feature specs',
        createdAt: '2026-11-09T20:00:00.000Z',
      },
      steps: {},
      updatedAt: '2026-11-09T20:00:00.000Z',
    })

    const parsed = readRunState(runDir)
    expect(parsed.status).toBe('waiting_for_gate')
    expect(parsed.activeGate?.stepId).toBe('step-clarify')
    expect(parsed.activeGate?.gateType).toBe('human_review')
    expect(parsed.activeGate?.prompt).toBe('Please enter feature specs')
  })

  it('accepts null activeGate', () => {
    const runDir = writeRawState(tempDir, {
      schemaVersion: 1,
      runId: 'run-gate-null',
      harnessName: 'test',
      status: 'running',
      activeStepId: 'step-1',
      activeGate: null,
      steps: {},
      updatedAt: '2026-11-09T20:00:00.000Z',
    })

    const parsed = readRunState(runDir)
    expect(parsed.activeGate).toBeNull()
  })
})

describe('readRunState activeGate invalid states', () => {
  it('rejects invalid activeGate objects', () => {
    const base = {
      schemaVersion: 1,
      runId: 'run-gate-invalid',
      harnessName: 'test',
      status: 'waiting_for_gate',
      activeStepId: 'step-1',
      steps: {},
      updatedAt: '2026-11-09T20:00:00.000Z',
    }

    expect(() => readRunState(writeRawState(tempDir, {
      ...base,
      activeGate: {
        stepId: 'step-1',
        phase: 'invalidPhase',
        guardrailIndex: 0,
        gateType: 'human_review',
        prompt: 'test',
        createdAt: '2026-11-09T20:00:00.000Z',
      },
    }))).toThrow(ZodError)

    expect(() => readRunState(writeRawState(tempDir, {
      ...base,
      activeGate: {
        stepId: 'step-1',
        phase: 'beforeStep',
        guardrailIndex: -1,
        gateType: 'human_review',
        prompt: 'test',
        createdAt: '2026-11-09T20:00:00.000Z',
      },
    }))).toThrow(ZodError)
  })
})
