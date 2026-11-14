import type { StepContext } from '../../types/context.js'
import fs from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readRunState, writeRunStateAtomic } from '../../persistence/state-store.js'
import * as envExec from '../environment-exec.js'
import { rehydrateEnvironmentsAndCheckHealth } from '../environment-manager.js'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-ephemeral-rehydrate-'))
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

function createMockStepContext(runId: string): StepContext {
  return {
    runId,
    environments: {},
    steps: {},
    step: { id: 'step-resume', output: null, attempt: 1 },
    matrix: undefined,
    artifacts: {} as any,
  }
}

function makeHostSnapshot(runId: string, descriptor: any) {
  return {
    schemaVersion: 1 as const,
    runId,
    harnessName: 'test-harness',
    workflowName: 'test-harness',
    status: 'running' as const,
    activeStepId: 'step-resume',
    environments: { host: descriptor },
    steps: {},
    updatedAt: new Date().toISOString(),
  }
}

describe('rehydration of host ephemeral ports and injected env (AC 7.5.3)', () => {
  it('restores identical port mappings and injected env for host environment without reallocation', async () => {
    const netSpy = vi.spyOn(net, 'createServer')
    const runId = 'run-rehydrate-host'
    const runDir = path.join(tmpDir, 'runs', runId)

    const initialDescriptor = {
      id: 'host',
      type: 'host',
      workingDir: tmpDir,
      ephemeralPorts: { APP_PORT: 51234, METRICS_PORT: 51235 },
      injectedEnv: {
        APP_PORT: '51234',
        METRICS_PORT: '51235',
        DB_NAME: 'test_run_rehydrate-host',
      },
      tornDown: false,
    }

    writeRunStateAtomic(runDir, makeHostSnapshot(runId, initialDescriptor))

    const state = readRunState(runDir)
    expect(state.environments?.host).toBeDefined()

    const ctx = createMockStepContext(runId)
    await rehydrateEnvironmentsAndCheckHealth({
      previousEnvironments: state.environments,
      ctx,
      workspaceDir: tmpDir,
    })

    const rehydratedEnv = ctx.environments.host
    expect(rehydratedEnv).toBeDefined()
    expect(rehydratedEnv.ephemeralPorts).toEqual({ APP_PORT: 51234, METRICS_PORT: 51235 })
    expect(rehydratedEnv.injectedEnv).toEqual({
      APP_PORT: '51234',
      METRICS_PORT: '51235',
      DB_NAME: 'test_run_rehydrate-host',
    })

    // Verify commands execute with the restored injected environment variables
    const res = await rehydratedEnv.exec('echo "PORT:$APP_PORT DB:$DB_NAME"')
    expect(res.exitCode).toBe(0)
    expect(res.stdout).toContain('PORT:51234 DB:test_run_rehydrate-host')

    // Net server creation was NEVER called during rehydration
    expect(netSpy).not.toHaveBeenCalled()
  })
})

describe('rehydration of git-worktree ephemeral ports and injected env', () => {
  it('restores git-worktree environment injected env and ephemeral ports', async () => {
    const wtDir = path.join(tmpDir, 'wt-rehydrated')
    fs.mkdirSync(wtDir)

    const execSpy = vi.spyOn(envExec, 'execHostCommand').mockResolvedValue({
      exitCode: 0,
      stdout: 'true\n',
      stderr: '',
      timedOut: false,
    })

    const ctx = createMockStepContext('r-wt-rehydrate')
    const previousDescriptor = {
      id: 'wt-env',
      type: 'git-worktree',
      workingDir: wtDir,
      ephemeralPorts: { SVC_PORT: 59999 },
      injectedEnv: { SVC_PORT: '59999', API_HOST: '127.0.0.1' },
      tornDown: false,
    }

    await rehydrateEnvironmentsAndCheckHealth({
      previousEnvironments: {
        'wt-env': previousDescriptor,
      },
      ctx,
      workspaceDir: tmpDir,
    })

    const env = ctx.environments['wt-env']
    expect(env.ephemeralPorts).toEqual({ SVC_PORT: 59999 })
    expect(env.injectedEnv).toEqual({ SVC_PORT: '59999', API_HOST: '127.0.0.1' })

    await env.exec(['git', 'status'])
    expect(execSpy).toHaveBeenLastCalledWith(
      wtDir,
      ['git', 'status'],
      expect.objectContaining({
        env: expect.objectContaining({ API_HOST: '127.0.0.1', SVC_PORT: '59999' }),
      }),
    )
  })
})

async function setupRehydratedDockerEnv(workspaceDir: string) {
  const wtDir = path.join(workspaceDir, 'dock-wt-rehydrated')
  fs.mkdirSync(wtDir)

  const execSpy = vi.spyOn(envExec, 'execHostCommand').mockResolvedValue({
    exitCode: 0,
    stderr: '',
    stdout: 'true\n',
    timedOut: false,
  })

  const ctx = createMockStepContext('r-dock-rehydrate')
  const previousDescriptor = {
    containerId: 'c-dock-rehydrate',
    ephemeralPorts: { DOCK_PORT: 58888 },
    id: 'dock-env',
    injectedEnv: { DOCK_PORT: '58888', DOCK_VAR: 'custom_val' },
    tornDown: false,
    type: 'docker-worktree',
    workingDir: wtDir,
  }

  await rehydrateEnvironmentsAndCheckHealth({
    ctx,
    previousEnvironments: {
      'dock-env': previousDescriptor,
    },
    workspaceDir,
  })

  return { env: ctx.environments['dock-env'], execSpy, wtDir }
}

describe('rehydration of docker-worktree ephemeral ports and injected env', () => {
  it('restores ports and passes merged env args to docker exec with options.env', async () => {
    const { env, execSpy, wtDir } = await setupRehydratedDockerEnv(tmpDir)

    expect(env.ephemeralPorts).toEqual({ DOCK_PORT: 58888 })
    expect(env.injectedEnv).toEqual({ DOCK_PORT: '58888', DOCK_VAR: 'custom_val' })

    await env.exec(['ls', '-l'], {
      env: { EXTRA: '1' },
    })
    expect(execSpy).toHaveBeenLastCalledWith(
      wtDir,
      [
        'docker',
        'exec',
        '-e',
        'DOCK_PORT=58888',
        '-e',
        'DOCK_VAR=custom_val',
        '-e',
        'EXTRA=1',
        'c-dock-rehydrate',
        'ls',
        '-l',
      ],
      expect.any(Object),
    )
  })
})

describe('rehydration of docker-worktree exec without extra env', () => {
  it('passes injected env args without options.env', async () => {
    const { env, execSpy, wtDir } = await setupRehydratedDockerEnv(tmpDir)

    await env.exec('echo hi')
    expect(execSpy).toHaveBeenLastCalledWith(
      wtDir,
      [
        'docker',
        'exec',
        '-e',
        'DOCK_PORT=58888',
        '-e',
        'DOCK_VAR=custom_val',
        'c-dock-rehydrate',
        'sh',
        '-c',
        'echo hi',
      ],
      expect.any(Object),
    )
  })
})
