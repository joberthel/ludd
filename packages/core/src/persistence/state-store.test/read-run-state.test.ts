import type { RunStateSnapshot } from '../../types/state.js'
import fs from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runHarness } from '../../runtime/run-harness.js'
import { readRunState, resolveRunDir, writeRunStateAtomic } from '../state-store.js'

let tempDir: string

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-read-state-test-'))
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

describe('readRunState basic round-trip', () => {
  it('reads and losslessly round-trips RunStateSnapshot written by writeRunStateAtomic', () => {
    const runDir = resolveRunDir(tempDir, 'run-roundtrip')
    const original: RunStateSnapshot = {
      schemaVersion: 1,
      runId: 'run-roundtrip',
      harnessName: 'roundtrip-harness',
      workflowName: 'roundtrip-harness',
      status: 'passed',
      activeStepId: null,
      activeGuardrailRetries: { 0: 2 },
      steps: {
        'step-passed-with-payload': {
          status: 'passed',
          output: {
            nested: {
              count: 42,
              tags: [
                'a',
                'b',
              ],
            },
          },
        },
        'step-skipped-without-output': {
          status: 'skipped',
        },
        'step-with-null-output': {
          status: 'failed',
          output: null,
        },
      },
      updatedAt: '2026-11-08T20:30:00.000Z',
    }

    writeRunStateAtomic(runDir, original)
    const read = readRunState(runDir)

    expect(read).toEqual(original)
  })
})

describe('readRunState artifacts and logs round-trip', () => {
  it('reads and losslessly round-trips RunStateSnapshot with artifacts and logs indexing', () => {
    const runDir = resolveRunDir(tempDir, 'run-artifacts-logs')
    const original: RunStateSnapshot = {
      schemaVersion: 1,
      runId: 'run-artifacts-logs',
      harnessName: 'artifacts-logs-harness',
      workflowName: 'artifacts-logs-harness',
      status: 'running',
      activeStepId: 'step-1',
      steps: {
        'step-1': { status: 'passed' },
      },
      artifacts: ['spec.md', 'todos.json'],
      logs: {
        'step-1-1': {
          logKey: 'step-1-1',
          format: 'text',
          totalLines: 100,
          filePath: 'logs/step-1-1.log',
        },
        'step-1-1-json': {
          logKey: 'step-1-1-json',
          format: 'json',
          totalItems: 4,
          propertyKey: 'errors',
        },
      },
      updatedAt: '2026-11-08T20:30:00.000Z',
    }

    writeRunStateAtomic(runDir, original)
    const read = readRunState(runDir)

    expect(read).toEqual(original)
  })
})

describe('readRunState runHarness persistence', () => {
  it('cleanly reads state.json persisted by runHarness() (AC 2.3.2)', async () => {
    const runId = 'run-harness-state-test'
    const config = {
      name: 'harness-persistence',
      steps: [
        {
          id: 'step-1',
          run: async () => ({ greeting: 'hello world' }),
        },
      ],
    }

    await runHarness(config, { runId, workspaceDir: tempDir })
    const runDir = resolveRunDir(tempDir, runId)
    const snapshot = readRunState(runDir)

    expect(snapshot.schemaVersion).toBe(1)
    expect(snapshot.runId).toBe(runId)
    expect(snapshot.harnessName).toBe('harness-persistence')
    expect(snapshot.status).toBe('passed')
    expect(snapshot.steps['step-1']).toEqual({
      status: 'passed',
      output: { greeting: 'hello world' },
    })
  })
})

describe('readRunState error handling', () => {
  it('throws when state.json does not exist', () => {
    const nonExistentDir = path.join(tempDir, 'does-not-exist')
    expect(() => readRunState(nonExistentDir)).toThrow()
  })

  it('throws SyntaxError when state.json contains invalid JSON syntax', () => {
    const runDir = path.join(tempDir, 'corrupted')
    fs.mkdirSync(runDir, { recursive: true })
    fs.writeFileSync(path.join(runDir, 'state.json'), 'not valid json {', 'utf-8')

    expect(() => readRunState(runDir)).toThrow(SyntaxError)
  })
})
