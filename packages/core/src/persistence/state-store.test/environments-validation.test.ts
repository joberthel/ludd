import fs from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ZodError } from 'zod'
import { readRunState } from '../state-store.js'

let tempDir: string

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-state-env-test-'))
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

describe('readRunState host environment descriptor validation', () => {
  it('accepts valid host environment descriptor', () => {
    const runDir = writeRawState({
      schemaVersion: 1,
      runId: 'run-env',
      harnessName: 'test',
      workflowName: 'test',
      status: 'running',
      activeStepId: null,
      environments: {
        host: {
          id: 'host',
          type: 'host',
          workingDir: '/foo/bar',
          branchName: 'main',
          tornDown: false,
        },
      },
      steps: {},
      updatedAt: '2026-11-08T20:00:00.000Z',
    })
    const parsed = readRunState(runDir)
    expect(parsed.environments?.host).toEqual({
      id: 'host',
      type: 'host',
      workingDir: '/foo/bar',
      branchName: 'main',
      tornDown: false,
    })
  })
})

describe('readRunState host environment with ports and injected env', () => {
  it('accepts host environment descriptor with ephemeralPorts and injectedEnv', () => {
    const runDir = writeRawState({
      schemaVersion: 1,
      runId: 'run-env-ports',
      harnessName: 'test',
      workflowName: 'test',
      status: 'running',
      activeStepId: null,
      environments: {
        host: {
          id: 'host',
          type: 'host',
          workingDir: '/foo/bar',
          ephemeralPorts: { APP_PORT: 54321 },
          injectedEnv: { APP_PORT: '54321', DB_NAME: 'test_db' },
          tornDown: false,
        },
      },
      steps: {},
      updatedAt: '2026-11-08T20:00:00.000Z',
    })
    const parsed = readRunState(runDir)
    expect(parsed.environments?.host).toEqual({
      id: 'host',
      type: 'host',
      workingDir: '/foo/bar',
      ephemeralPorts: { APP_PORT: 54321 },
      injectedEnv: { APP_PORT: '54321', DB_NAME: 'test_db' },
      tornDown: false,
    })
  })
})

describe('readRunState docker-worktree environment descriptor validation', () => {
  it('accepts valid docker-worktree environment descriptor with containerId', () => {
    const dockerDir = writeRawState({
      schemaVersion: 1,
      runId: 'run-docker-env',
      harnessName: 'test',
      workflowName: 'test',
      status: 'running',
      activeStepId: null,
      environments: {
        'docker-wt': {
          id: 'docker-wt',
          type: 'docker-worktree',
          workingDir: '/worktrees/wt-1',
          branchName: 'ludd/wt-1',
          containerId: 'c1234567890abcdef',
          tornDown: false,
        },
      },
      steps: {},
      updatedAt: '2026-11-08T20:00:00.000Z',
    })
    const parsedDocker = readRunState(dockerDir)
    expect(parsedDocker.environments?.['docker-wt']).toEqual({
      id: 'docker-wt',
      type: 'docker-worktree',
      workingDir: '/worktrees/wt-1',
      branchName: 'ludd/wt-1',
      containerId: 'c1234567890abcdef',
      tornDown: false,
    })
  })
})

describe('readRunState environments invalid descriptors', () => {
  it('rejects invalid descriptors', () => {
    const invalidDir = writeRawState({
      schemaVersion: 1,
      runId: 'run-invalid-env',
      harnessName: 'test',
      workflowName: 'test',
      status: 'running',
      activeStepId: null,
      environments: {
        host: { id: 123 },
      },
      steps: {},
      updatedAt: '2026-11-08T20:00:00.000Z',
    })
    expect(() => readRunState(invalidDir)).toThrow(ZodError)
  })
})
