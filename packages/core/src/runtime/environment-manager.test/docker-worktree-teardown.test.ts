import type { StepContext } from '../../types/context.js'
import type { RunStateSnapshot } from '../../types/state.js'
import fs from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as envExec from '../environment-exec.js'
import {
  createDockerWorktreeEnvironmentFromDescriptor,
  recordEnvironment,
} from '../environment-manager.js'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-dock-td-test-'))
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

describe('createDockerWorktreeEnvironmentFromDescriptor teardown', () => {
  it('stops container and removes worktree directory', async () => {
    const wtDir = path.join(tmpDir, '.harness', 'worktrees', 'run-1-dock')
    fs.mkdirSync(wtDir, { recursive: true })

    const execSpy = vi.spyOn(envExec, 'execHostCommand')
    execSpy.mockResolvedValue({
      exitCode: 0,
      stdout: '',
      stderr: '',
      timedOut: false,
    })

    const env = createDockerWorktreeEnvironmentFromDescriptor(
      { id: 'dock-td', workingDir: wtDir, containerId: 'c-td' },
      undefined,
      tmpDir,
    )

    await env.teardown()
    expect(execSpy).toHaveBeenCalledWith(tmpDir, ['docker', 'rm', '-f', 'c-td'], expect.any(Object))
    expect(execSpy).toHaveBeenCalledWith(tmpDir, [
      'git',
      'worktree',
      'remove',
      '--force',
      wtDir,
    ], expect.any(Object))
    expect(fs.existsSync(wtDir)).toBe(false)

    // Second call handles non-existent working dir cleanly
    await env.teardown()

    execSpy.mockRestore()
  })

  it('handles teardown errors and handles absent containerId', async () => {
    const wtDir = path.join(tmpDir, 'wt-err')
    fs.mkdirSync(wtDir, { recursive: true })

    const execSpy = vi.spyOn(envExec, 'execHostCommand')
    execSpy.mockRejectedValue(new Error('command failure'))

    const env = createDockerWorktreeEnvironmentFromDescriptor({
      id: 'dock-td-fallback',
      workingDir: wtDir,
      containerId: 'c-fail',
    })
    await env.teardown()
    expect(fs.existsSync(wtDir)).toBe(false)

    const envNoCid = createDockerWorktreeEnvironmentFromDescriptor({
      id: 'dock-td-no-cid',
      workingDir: wtDir,
    })
    await envNoCid.teardown()

    execSpy.mockRestore()
  })
})

describe('recordEnvironment with containerId', () => {
  it('records containerId in snapshot environments', () => {
    const ctx: StepContext = {
      runId: 'r-rec',
      environments: {},
      steps: {},
      step: { id: 's-1', output: null, attempt: 1 },
      matrix: undefined,
      artifacts: {} as any,
    }
    const snapshot: RunStateSnapshot = {
      schemaVersion: 1,
      runId: 'r-rec',
      harnessName: 'test',
      workflowName: 'test',
      status: 'running',
      activeStepId: 's-1',
      steps: {},
      updatedAt: new Date().toISOString(),
    }
    const env = createDockerWorktreeEnvironmentFromDescriptor({
      id: 'dock-rec',
      workingDir: tmpDir,
      containerId: 'c-rec-123',
    })
    recordEnvironment(env, ctx, snapshot)
    expect(snapshot.environments?.['dock-rec']?.containerId).toBe('c-rec-123')
  })
})
