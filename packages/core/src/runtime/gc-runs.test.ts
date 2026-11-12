import type { RunStateSnapshot, RunStatus } from '../types/state.js'
import fs from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RUNNER_PID_FILE } from '../persistence/pid-lock.js'
import { writeRunStateAtomic } from '../persistence/state-store.js'
import { gc, parseDurationToMs } from './gc-runs.js'

let tempDir: string

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-gc-test-'))
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

function createRun(
  runId: string,
  status: RunStatus,
  updatedAt: string,
  pid?: number,
): string {
  const runDir = path.join(tempDir, '.harness', 'runs', runId)
  fs.mkdirSync(runDir, { recursive: true })
  const snapshot: RunStateSnapshot = {
    schemaVersion: 1,
    runId,
    harnessName: 'test-harness',
    workflowName: 'test-harness',
    status,
    activeStepId: null,
    steps: {},
    updatedAt,
  }
  writeRunStateAtomic(runDir, snapshot)
  if (pid !== undefined) {
    fs.writeFileSync(path.join(runDir, RUNNER_PID_FILE), `${pid}\n`, 'utf-8')
  }
  return runDir
}

describe('gc runner status & pid lock handling', () => {
  it('returns empty results when .harness/runs does not exist', async () => {
    const res = await gc({ workspaceDir: tempDir })
    expect(res).toEqual({ cleanedRunIds: [], skippedActiveRunIds: [] })
  })

  it('skips non-directory files in runs directory', async () => {
    const runsDir = path.join(tempDir, '.harness', 'runs')
    fs.mkdirSync(runsDir, { recursive: true })
    fs.writeFileSync(path.join(runsDir, 'stray.txt'), 'hello', 'utf-8')

    const res = await gc({ workspaceDir: tempDir })
    expect(res).toEqual({ cleanedRunIds: [], skippedActiveRunIds: [] })
  })

  it('skips active runs with live pid and records in skippedActiveRunIds', async () => {
    createRun('active-run', 'running', new Date().toISOString(), process.pid)
    createRun('dead-run', 'passed', new Date(Date.now() - 60000).toISOString(), 999999)

    const res = await gc({ workspaceDir: tempDir })
    expect(res.skippedActiveRunIds).toEqual(['active-run'])
    expect(res.cleanedRunIds).toEqual(['dead-run'])
    expect(fs.existsSync(path.join(tempDir, '.harness', 'runs', 'dead-run'))).toBe(false)
    expect(fs.existsSync(path.join(tempDir, '.harness', 'runs', 'active-run'))).toBe(true)
  })
})

it('filters by one or more run IDs before checking active-run status', async () => {
  createRun('wanted', 'passed', new Date().toISOString())
  createRun('unwanted-active', 'running', new Date().toISOString(), process.pid)
  const result = await gc({
    workspaceDir: tempDir,
    runId: ['wanted'],
  })
  expect(result.cleanedRunIds).toEqual(['wanted'])
  expect(result.skippedActiveRunIds).toEqual([])
  expect(fs.existsSync(path.join(tempDir, '.harness', 'runs', 'unwanted-active'))).toBe(true)
})

it('accepts a single run ID as a string filter', async () => {
  createRun('single-wanted', 'passed', new Date().toISOString())
  createRun('single-unwanted', 'passed', new Date().toISOString())
  const result = await gc({ workspaceDir: tempDir, runId: 'single-wanted' })
  expect(result.cleanedRunIds).toEqual(['single-wanted'])
  expect(fs.existsSync(path.join(tempDir, '.harness', 'runs', 'single-unwanted'))).toBe(true)
})
it('filters by run status correctly', async () => {
  createRun('run-passed', 'passed', new Date().toISOString())
  createRun('run-failed', 'failed', new Date().toISOString())

  const res = await gc({
    workspaceDir: tempDir,
    status: ['passed'],
  })
  expect(res.cleanedRunIds).toEqual(['run-passed'])
  expect(fs.existsSync(path.join(tempDir, '.harness', 'runs', 'run-failed'))).toBe(true)
})

it('filters by olderThan duration string', async () => {
  const oldTime = new Date(Date.now() - 3600000).toISOString()
  const newTime = new Date().toISOString()
  createRun('run-old', 'passed', oldTime)
  createRun('run-new', 'passed', newTime)

  const res = await gc({ workspaceDir: tempDir, olderThan: '30m' })
  expect(res.cleanedRunIds).toEqual(['run-old'])
  expect(fs.existsSync(path.join(tempDir, '.harness', 'runs', 'run-new'))).toBe(true)
})

it('filters by olderThanMs threshold', async () => {
  createRun('run-old-ms', 'passed', new Date(Date.now() - 10000).toISOString())
  createRun('run-new-ms', 'passed', new Date().toISOString())

  const res = await gc({ workspaceDir: tempDir, olderThanMs: 5000 })
  expect(res.cleanedRunIds).toEqual(['run-old-ms'])
})

it('skips runs missing state or valid updatedAt when filters apply', async () => {
  const rawDir = path.join(tempDir, '.harness', 'runs', 'no-state')
  fs.mkdirSync(rawDir, { recursive: true })
  const corruptDir = path.join(tempDir, '.harness', 'runs', 'corrupt-state')
  fs.mkdirSync(corruptDir, { recursive: true })
  fs.writeFileSync(path.join(corruptDir, 'state.json'), 'not-json', 'utf-8')

  const resStatus = await gc({
    workspaceDir: tempDir,
    status: ['passed'],
  })
  expect(resStatus.cleanedRunIds).toEqual([])

  const resTime = await gc({ workspaceDir: tempDir, olderThanMs: 1000 })
  expect(resTime.cleanedRunIds).toEqual([])
})

describe('gc dryRun mode & duration parsing', () => {
  it('identifies runs in dryRun without deleting them from disk', async () => {
    createRun('dry-run-target', 'passed', new Date().toISOString())

    const res = await gc({ workspaceDir: tempDir, dryRun: true })
    expect(res.cleanedRunIds).toEqual(['dry-run-target'])
    expect(fs.existsSync(path.join(tempDir, '.harness', 'runs', 'dry-run-target'))).toBe(true)
  })

  it('parses various duration units and rejects invalid formats', () => {
    expect(parseDurationToMs(500)).toBe(500)
    expect(parseDurationToMs('500')).toBe(500)
    expect(parseDurationToMs('10s')).toBe(10000)
    expect(parseDurationToMs('5m')).toBe(300000)
    expect(parseDurationToMs('2h')).toBe(7200000)
    expect(parseDurationToMs('1d')).toBe(86400000)
    expect(parseDurationToMs('1w')).toBe(604800000)
    expect(() => parseDurationToMs('invalid')).toThrow(/Invalid duration format/)
  })

  it('defaults workspaceDir to process.cwd() when omitted', async () => {
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tempDir)
    try {
      const res = await gc()
      expect(res).toEqual({ cleanedRunIds: [], skippedActiveRunIds: [] })
    }
    finally {
      cwdSpy.mockRestore()
    }
  })
})
