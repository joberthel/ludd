import type { RunStateSnapshot, RunStatus } from '../types/state.js'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { isProcessAlive, RUNNER_PID_FILE } from '../persistence/pid-lock.js'
import { readRunState } from '../persistence/state-store.js'
import { teardownRun } from './teardown-run.js'

export interface GcOptions {
  workspaceDir?: string
  olderThanMs?: number
  olderThan?: number | string
  status?: RunStatus[]
  dryRun?: boolean
}

export interface GcResult {
  cleanedRunIds: string[]
  skippedActiveRunIds: string[]
}

const UNIT_MULTIPLIERS: Record<string, number> = {
  ms: 1,
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
  w: 7 * 24 * 60 * 60 * 1000,
}

export function parseDurationToMs(value: number | string): number {
  if (typeof value === 'number') {
    return value
  }
  const trimmed = value.trim()
  const match = trimmed.match(/^(\d+(?:\.\d+)?)\s*(ms|[smhdw])?$/)
  if (!match) {
    throw new Error(`Invalid duration format: "${value}". Expected format like "5s", "30m", "1h", "1d".`)
  }
  const amount = Number.parseFloat(match[1])
  const unit = match[2] ?? 'ms'
  const multiplier = UNIT_MULTIPLIERS[unit]
  return amount * multiplier
}

function resolveThreshold(options?: GcOptions): number | undefined {
  if (options?.olderThanMs !== undefined) {
    return Date.now() - options.olderThanMs
  }
  if (options?.olderThan !== undefined) {
    return Date.now() - parseDurationToMs(options.olderThan)
  }
  return undefined
}

function isRunnerAlive(runDir: string): boolean {
  const pidFilePath = path.join(runDir, RUNNER_PID_FILE)
  if (!fs.existsSync(pidFilePath)) {
    return false
  }
  const content = fs.readFileSync(pidFilePath, 'utf-8').trim()
  const pid = Number.parseInt(content, 10)
  return isProcessAlive(pid)
}

function readStateIfPresent(runDir: string): RunStateSnapshot | undefined {
  const statePath = path.join(runDir, 'state.json')
  if (!fs.existsSync(statePath)) {
    return undefined
  }
  try {
    return readRunState(runDir)
  }
  catch {
    return undefined
  }
}

function shouldSkipRun(
  state: RunStateSnapshot | undefined,
  statusFilter?: RunStatus[],
  threshold?: number,
): boolean {
  if (statusFilter !== undefined && (!state || !statusFilter.includes(state.status))) {
    return true
  }
  if (threshold !== undefined) {
    if (typeof state?.updatedAt !== 'string') {
      return true
    }
    const stateTime = new Date(state.updatedAt).getTime()
    if (Number.isNaN(stateTime) || stateTime > threshold) {
      return true
    }
  }
  return false
}

export async function gc(options?: GcOptions): Promise<GcResult> {
  const workspaceDir = options?.workspaceDir ?? process.cwd()
  const runsDir = path.resolve(workspaceDir, '.harness', 'runs')
  if (!fs.existsSync(runsDir)) {
    return { cleanedRunIds: [], skippedActiveRunIds: [] }
  }

  const threshold = resolveThreshold(options)
  const cleanedRunIds: string[] = []
  const skippedActiveRunIds: string[] = []
  const entries = fs.readdirSync(runsDir, { withFileTypes: true })

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue
    }
    const runId = entry.name
    const runDir = path.join(runsDir, runId)
    if (isRunnerAlive(runDir)) {
      skippedActiveRunIds.push(runId)
      continue
    }

    const state = readStateIfPresent(runDir)
    if (shouldSkipRun(state, options?.status, threshold)) {
      continue
    }

    if (options?.dryRun !== true) {
      await teardownRun(runId, { workspaceDir, force: true })
      fs.rmSync(runDir, { recursive: true, force: true })
    }
    cleanedRunIds.push(runId)
  }

  return { cleanedRunIds, skippedActiveRunIds }
}
