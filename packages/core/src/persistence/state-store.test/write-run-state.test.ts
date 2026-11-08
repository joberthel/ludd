import type { RunStateSnapshot } from '../../types/state.js'
import fs from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolveRunDir, writeRunStateAtomic } from '../state-store.js'

describe('resolveRunDir', () => {
  it('resolves scoped run path under .harness/runs/<runId>', () => {
    const workspace = '/workspace/project'
    const runId = 'test-run-123'
    const resolved = resolveRunDir(workspace, runId)
    expect(resolved).toBe(path.resolve(workspace, '.harness', 'runs', runId))
  })

  it('resolves relative workspace paths against current working directory', () => {
    const relative = 'relative/path'
    const runId = 'run-456'
    const expected = path.resolve(process.cwd(), relative, '.harness', 'runs', runId)
    expect(resolveRunDir(relative, runId)).toBe(expected)
  })
})

describe('writeRunStateAtomic initialization', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-state-store-init-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('creates run directory and writes state.json snapshot atomically', () => {
    const runDir = resolveRunDir(tempDir, 'run-1')
    const sampleState: RunStateSnapshot = {
      schemaVersion: 1,
      runId: 'run-1',
      harnessName: 'test-harness',
      status: 'running',
      activeStepId: 'step-a',
      steps: {
        'step-0': {
          status: 'passed',
          output: { value: 1 },
        },
      },
      updatedAt: '2026-11-08T20:00:00.000Z',
    }

    writeRunStateAtomic(runDir, sampleState)

    const stateFilePath = path.join(runDir, 'state.json')
    const tmpFilePath = path.join(runDir, 'state.json.tmp')

    expect(fs.existsSync(stateFilePath)).toBe(true)
    expect(fs.existsSync(tmpFilePath)).toBe(false)

    const raw = fs.readFileSync(stateFilePath, 'utf-8')
    const parsed = JSON.parse(raw) as RunStateSnapshot
    expect(parsed).toEqual(sampleState)
    expect(raw.endsWith('\n')).toBe(true)
  })
})

describe('writeRunStateAtomic updates', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-state-store-update-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('atomically overwrites existing state.json across state updates', () => {
    const runDir = resolveRunDir(tempDir, 'run-2')
    const initialState: RunStateSnapshot = {
      schemaVersion: 1,
      runId: 'run-2',
      harnessName: 'test-harness',
      status: 'running',
      activeStepId: 'step-1',
      steps: {},
      updatedAt: '2026-11-08T20:00:00.000Z',
    }

    writeRunStateAtomic(runDir, initialState)

    const updatedState: RunStateSnapshot = {
      ...initialState,
      status: 'passed',
      activeStepId: null,
      steps: {
        'step-1': {
          status: 'passed',
          output: 'done',
        },
      },
      updatedAt: '2026-11-08T20:01:00.000Z',
    }

    writeRunStateAtomic(runDir, updatedState)

    const stateFilePath = path.join(runDir, 'state.json')
    const tmpFilePath = path.join(runDir, 'state.json.tmp')

    expect(fs.existsSync(tmpFilePath)).toBe(false)
    const raw = fs.readFileSync(stateFilePath, 'utf-8')
    const parsed = JSON.parse(raw) as RunStateSnapshot
    expect(parsed).toEqual(updatedState)
  })
})
