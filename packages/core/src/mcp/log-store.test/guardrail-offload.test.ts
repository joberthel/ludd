import type { GuardrailVerdict } from '../../types/guardrail.js'
import type { RunStateSnapshot } from '../../types/state.js'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readRunState } from '../../persistence/state-store.js'
import { createLogStore, offloadGuardrailLog } from '../log-store.js'

describe('offloadGuardrailLog rawLog handling', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ludd-offload-raw-'))
  })

  afterEach(async () => {
    await fs.promises.rm(tempDir, { recursive: true, force: true })
  })

  it('offloads verdict rawLog and updates snapshot on disk', async () => {
    const snapshot: RunStateSnapshot = {
      schemaVersion: 1,
      runId: 'r-offload',
      harnessName: 'offload-harness',
      workflowName: 'offload-harness',
      status: 'running',
      activeStepId: 'step-x',
      steps: {},
      updatedAt: new Date().toISOString(),
    }

    const verdict: GuardrailVerdict = {
      status: 'fail',
      rawLog: 'Error: process exited with code 1\nStack trace line 1\nStack trace line 2',
    }

    const meta = await offloadGuardrailLog(tempDir, snapshot, 'step-x', 1, 'afterStep', 0, verdict)
    expect(meta.logKey).toBe('step-x-1-afterStep-0')
    expect(verdict.logKey).toBe('step-x-1-afterStep-0')

    const reloaded = readRunState(tempDir)
    expect(reloaded.logs?.['step-x-1']).toBeUndefined()
    expect(reloaded.logs?.['step-x-1-afterStep-0']?.format).toBe('text')
    expect(reloaded.logs?.['step-x-1-afterStep-0']?.totalLines).toBe(3)
  })
})

describe('offloadGuardrailLog body and status fallbacks', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ludd-offload-body-'))
  })

  afterEach(async () => {
    await fs.promises.rm(tempDir, { recursive: true, force: true })
  })

  it('handles body string and body object fallbacks when rawLog is absent', async () => {
    const snapshot: RunStateSnapshot = {
      schemaVersion: 1,
      runId: 'r-offload-body',
      harnessName: 'offload-harness',
      workflowName: 'offload-harness',
      status: 'running',
      activeStepId: 'step-b',
      steps: {},
      updatedAt: new Date().toISOString(),
    }

    const verdict1: GuardrailVerdict = { status: 'fail', body: 'Simple error message' }
    await offloadGuardrailLog(tempDir, snapshot, 'step-b', 1, 'afterStep', 0, verdict1)
    const store = createLogStore(tempDir)
    const lines1 = await store.readLines('step-b-1-afterStep-0', 1, 5)
    expect(lines1?.lines).toEqual(['Simple error message'])

    const verdict2: GuardrailVerdict = {
      status: 'fail',
      body: {
        issues: ['issue 1'],
      },
    }
    await offloadGuardrailLog(tempDir, snapshot, 'step-b', 2, 'afterStep', 0, verdict2)
    const lines2 = await store.readLines('step-b-2-afterStep-0', 1, 5)
    expect(lines2?.lines[0]).toBe('{')

    const verdict3: GuardrailVerdict = { status: 'skip' }
    await offloadGuardrailLog(tempDir, snapshot, 'step-b', 3, 'beforeStep', 0, verdict3)
    const lines3 = await store.readLines('step-b-3-beforeStep-0', 1, 5)
    expect(lines3?.lines[0]).toBe('Guardrail #0 returned skip')
  })

  it('keeps logs distinct across guardrail indices, phases, and matrix slices', async () => {
    const snapshot: RunStateSnapshot = {
      schemaVersion: 1,
      runId: 'r-offload-unique',
      harnessName: 'offload-harness',
      workflowName: 'offload-harness',
      status: 'running',
      activeStepId: 'step-m',
      steps: {},
      updatedAt: new Date().toISOString(),
    }

    const beforeVerdict: GuardrailVerdict = { status: 'fail', rawLog: 'beforeStep log' }
    const afterVerdict0: GuardrailVerdict = { status: 'fail', rawLog: 'afterStep 0 log' }
    const afterVerdict1: GuardrailVerdict = { status: 'fail', rawLog: 'afterStep 1 log' }
    const matrix0Verdict: GuardrailVerdict = { status: 'fail', rawLog: 'matrix slice 0 log' }
    const matrix1Verdict: GuardrailVerdict = { status: 'fail', rawLog: 'matrix slice 1 log' }

    await offloadGuardrailLog(tempDir, snapshot, 'step-m', 1, 'beforeStep', 0, beforeVerdict)
    await offloadGuardrailLog(tempDir, snapshot, 'step-m', 1, 'afterStep', 0, afterVerdict0)
    await offloadGuardrailLog(tempDir, snapshot, 'step-m', 1, 'afterStep', 1, afterVerdict1)
    await offloadGuardrailLog(tempDir, snapshot, 'step-m', 1, 'afterStep', 0, matrix0Verdict, undefined, 0)
    await offloadGuardrailLog(tempDir, snapshot, 'step-m', 1, 'afterStep', 0, matrix1Verdict, undefined, 1)

    expect(beforeVerdict.logKey).toBe('step-m-1-beforeStep-0')
    expect(afterVerdict0.logKey).toBe('step-m-1-afterStep-0')
    expect(afterVerdict1.logKey).toBe('step-m-1-afterStep-1')
    expect(matrix0Verdict.logKey).toBe('step-m-m0-1-afterStep-0')
    expect(matrix1Verdict.logKey).toBe('step-m-m1-1-afterStep-0')

    const store = createLogStore(tempDir)
    expect((await store.readLines('step-m-1-beforeStep-0', 1, 5))?.lines).toEqual(['beforeStep log'])
    expect((await store.readLines('step-m-1-afterStep-0', 1, 5))?.lines).toEqual(['afterStep 0 log'])
    expect((await store.readLines('step-m-1-afterStep-1', 1, 5))?.lines).toEqual(['afterStep 1 log'])
    expect((await store.readLines('step-m-m0-1-afterStep-0', 1, 5))?.lines).toEqual(['matrix slice 0 log'])
    expect((await store.readLines('step-m-m1-1-afterStep-0', 1, 5))?.lines).toEqual(['matrix slice 1 log'])
  })
})
