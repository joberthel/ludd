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

describe('readRunState environments validation', () => {
  it('accepts valid environments map and rejects invalid descriptors', () => {
    const runDir = writeRawState({
      schemaVersion: 1,
      runId: 'run-env',
      harnessName: 'test',
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

    const invalidDir = writeRawState({
      schemaVersion: 1,
      runId: 'run-invalid-env',
      harnessName: 'test',
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
