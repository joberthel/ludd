import type { HarnessConfig, RunLifecycleContext } from '../types/harness.js'
import type { RunStateSnapshot } from '../types/state.js'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { HarnessConfigLoadError } from '../errors/harness-config-load-error.js'
import { RunAlreadyActiveError } from '../errors/run-already-active-error.js'
import { loadHarnessConfig } from '../loader/load-harness-config.js'
import { appendLedgerEvent } from '../persistence/ledger-writer.js'
import { isProcessAlive, RUNNER_PID_FILE } from '../persistence/pid-lock.js'
import { readRunState, resolveRunDir, writeRunStateAtomic } from '../persistence/state-store.js'

export interface TeardownRunOptions {
  workspaceDir?: string
  force?: boolean
  configPath?: string
  config?: Pick<HarnessConfig, 'teardown'>
  teardown?: (ctx: RunLifecycleContext) => void | Promise<void>
  signal?: AbortSignal
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
  if (isProcessAlive(pid) && !force) {
    throw new RunAlreadyActiveError(runId, pid)
  }
}

async function resolveTeardownHook(
  workspaceDir: string,
  snapshot: RunStateSnapshot,
  options?: TeardownRunOptions,
): Promise<HarnessConfig['teardown']> {
  if (options?.teardown !== undefined) {
    return options.teardown
  }
  if (options?.config !== undefined) {
    return options.config.teardown
  }
  if (options?.configPath !== undefined) {
    const targetPath = options.configPath.trim() === ''
      ? options.configPath
      : path.resolve(workspaceDir, options.configPath)
    const loaded = await loadHarnessConfig(targetPath)
    return loaded.teardown
  }
  if (snapshot.configPath === undefined || snapshot.configPath.trim() === '') {
    return undefined
  }
  try {
    const loaded = await loadHarnessConfig(path.resolve(workspaceDir, snapshot.configPath))
    return loaded.teardown
  }
  catch (error: unknown) {
    if (options?.force && error instanceof HarnessConfigLoadError) {
      return undefined
    }
    throw error
  }
}

function finalizeRunState(
  runDir: string,
  runId: string,
  snapshot: RunStateSnapshot,
  hookInvoked: boolean,
  force?: boolean,
): void {
  appendLedgerEvent(runDir, {
    schemaVersion: 1,
    timestamp: new Date().toISOString(),
    runId,
    stepId: null,
    eventType: 'run.teardown',
    payload: {
      hookInvoked,
      forced: Boolean(force),
    },
  })

  const isIncomplete = snapshot.status === 'running' || snapshot.status === 'waiting_for_gate'
  const updatedSnapshot: RunStateSnapshot = {
    ...snapshot,
    ...(isIncomplete
      ? {
          status: 'failed' as const,
          activeStepId: null,
          activeGate: null,
          activeSessionId: null,
          activeMatrixIndex: null,
        }
      : {}),
    updatedAt: new Date().toISOString(),
  }
  writeRunStateAtomic(runDir, updatedSnapshot)

  if (force) {
    fs.rmSync(path.join(runDir, RUNNER_PID_FILE), { force: true })
  }
}

/** Runs optional harness teardown hook and finalizes run state on disk. */
export async function teardownRun(
  runId: string,
  options?: TeardownRunOptions,
): Promise<TeardownRunResult> {
  const workspaceDir = path.resolve(options?.workspaceDir ?? process.cwd())
  const runDir = resolveRunDir(workspaceDir, runId)

  verifyRunnerNotActive(runDir, runId, options?.force)

  const statePath = path.join(runDir, 'state.json')
  if (!fs.existsSync(statePath)) {
    return { ok: true }
  }

  const snapshot = readRunState(runDir)
  const teardownHook = await resolveTeardownHook(workspaceDir, snapshot, options)
  const lifecycleCtx: RunLifecycleContext = {
    runId,
    workspaceRoot: workspaceDir,
    signal: options?.signal ?? new AbortController().signal,
  }

  if (teardownHook !== undefined) {
    await teardownHook(lifecycleCtx)
  }

  finalizeRunState(runDir, runId, snapshot, teardownHook !== undefined, options?.force)
  return { ok: true }
}
