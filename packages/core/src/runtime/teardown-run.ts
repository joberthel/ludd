import type { ProvisionedEnvironment } from '../types/environment.js'
import type { EnvironmentDescriptor, RunStateSnapshot } from '../types/state.js'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { RunAlreadyActiveError } from '../errors/run-already-active-error.js'
import { appendLedgerEvent } from '../persistence/ledger-writer.js'
import { isProcessAlive, RUNNER_PID_FILE } from '../persistence/pid-lock.js'
import { readRunState, resolveRunDir, writeRunStateAtomic } from '../persistence/state-store.js'
import {
  createGitWorktreeEnvironmentFromDescriptor,
  createHostEnvironmentFromDescriptor,
} from './environment-manager.js'

export interface TeardownRunOptions {
  workspaceDir?: string
  force?: boolean
  environments?: Record<string, ProvisionedEnvironment>
}

export interface TeardownRunResult {
  ok: boolean
}

function verifyRunnerNotActive(runDir: string, runId: string, force?: boolean): void {
  const pidPath = path.join(runDir, RUNNER_PID_FILE)
  if (!fs.existsSync(pidPath)) {
    return
  }
  const content = fs.readFileSync(pidPath, 'utf-8')
  const pid = Number.parseInt(content.trim(), 10)
  if (isProcessAlive(pid)) {
    if (!force) {
      throw new RunAlreadyActiveError(runId, pid)
    }
  }
  if (force) {
    fs.rmSync(pidPath, { force: true })
  }
}

function createEnvironmentFromDescriptor(
  desc: EnvironmentDescriptor,
  workspaceDir?: string,
): ProvisionedEnvironment {
  return desc.type === 'git-worktree'
    ? createGitWorktreeEnvironmentFromDescriptor(desc, undefined, workspaceDir)
    : createHostEnvironmentFromDescriptor(desc)
}

function collectEnvironmentsToTeardown(
  snapshot: RunStateSnapshot,
  options?: TeardownRunOptions,
): Map<string, ProvisionedEnvironment> {
  const envMap = new Map<string, ProvisionedEnvironment>()
  if (options?.environments !== undefined) {
    for (const [id, env] of Object.entries(options.environments)) {
      envMap.set(id, env)
    }
  }
  if (snapshot.environments !== undefined) {
    for (const [id, desc] of Object.entries(snapshot.environments)) {
      if (!envMap.has(id)) {
        envMap.set(id, createEnvironmentFromDescriptor(desc, options?.workspaceDir))
      }
    }
  }
  return envMap
}

export async function teardownRun(
  runId: string,
  options?: TeardownRunOptions,
): Promise<TeardownRunResult> {
  const workspaceDir = options?.workspaceDir ?? process.cwd()
  const runDir = resolveRunDir(workspaceDir, runId)

  verifyRunnerNotActive(runDir, runId, options?.force)

  const snapshot = readRunState(runDir)
  const envMap = collectEnvironmentsToTeardown(snapshot, options)
  const envList = Array.from(envMap.values())

  await Promise.all(envList.map(async env => env.teardown()))

  appendLedgerEvent(runDir, {
    schemaVersion: 1,
    timestamp: new Date().toISOString(),
    runId,
    stepId: null,
    eventType: 'run.teardown',
    payload: {
      environments: Array.from(envMap.keys()),
      forced: Boolean(options?.force),
    },
  })

  snapshot.environments = {}
  snapshot.updatedAt = new Date().toISOString()
  writeRunStateAtomic(runDir, snapshot)

  return { ok: true }
}
