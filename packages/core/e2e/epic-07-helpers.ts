import type { HarnessConfig, HostSpawnResult, RunLifecycleContext } from '../src/index.js'
import cp from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { mockAgent } from '@luddjs/agents'
import { execGuardrail } from '@luddjs/guardrails'
import { expect } from 'vitest'
import {
  createControlClient,
  resolveRunDir,
  runHarness,
  RUNNER_PID_FILE,
  spawn,
  writeRunStateAtomic,
} from '../src/index.js'
import { inspectSpawnEnv } from './epic-07-env-helpers.js'

const RUN_ID_PATTERN = /^[\w.-]+$/

export interface TeardownRecord {
  runId: string
  workspaceRoot: string
  aborted: boolean
}

export function validateRunId(runId: string): string {
  if (runId === '.' || runId === '..' || !RUN_ID_PATTERN.test(runId)) {
    throw new Error(`Invalid runId "${runId}" for worktree path.`)
  }
  return runId
}

export function initTestGitRepo(dir: string): void {
  cp.execFileSync('git', ['init', '-b', 'main'], { cwd: dir })
  cp.execFileSync('git', ['config', 'user.name', 'Ludd E2E'], { cwd: dir })
  cp.execFileSync('git', ['config', 'user.email', 'e2e@luddjs.dev'], { cwd: dir })
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'src', 'app.ts'), '// initial base\nexport const app = "base"\n', 'utf-8')
  fs.writeFileSync(path.join(dir, '.gitignore'), '.harness/\n', 'utf-8')
  cp.execFileSync('git', ['add', '-A'], { cwd: dir })
  cp.execFileSync('git', ['commit', '-m', 'initial commit'], { cwd: dir })
}

export function resolveWorktreeDir(workspaceRoot: string, runId: string): string {
  return path.resolve(workspaceRoot, '.harness', 'worktrees', `${validateRunId(runId)}-wt`)
}

export function resolveBranchName(runId: string): string {
  return `ludd/${validateRunId(runId)}-wt`
}

function formatGitError(result: HostSpawnResult): string {
  return result.stderr.trim() || result.stdout.trim() || `exit code ${result.exitCode ?? 'unknown'}`
}

export async function createWorktree(workspaceRoot: string, runId: string, signal?: AbortSignal): Promise<string> {
  const root = path.resolve(workspaceRoot)
  const worktreeDir = resolveWorktreeDir(root, runId)
  fs.mkdirSync(path.dirname(worktreeDir), { recursive: true })
  const res = await spawn({
    command: 'git',
    args: [
      'worktree',
      'add',
      '-b',
      resolveBranchName(runId),
      worktreeDir,
      'HEAD',
    ],
    cwd: root,
    signal,
  })
  if (res.exitCode !== 0) {
    throw new Error(`Failed to create worktree: ${formatGitError(res)}`)
  }
  return worktreeDir
}

export async function removeWorktree(workspaceRoot: string, runId: string, signal?: AbortSignal): Promise<void> {
  const root = path.resolve(workspaceRoot)
  const worktreeDir = resolveWorktreeDir(root, runId)
  if (!fs.existsSync(worktreeDir)) {
    const pruneRes = await spawn({
      command: 'git',
      args: ['worktree', 'prune'],
      cwd: root,
      signal,
    })
    if (pruneRes.exitCode !== 0) {
      throw new Error(`Failed to prune worktrees: ${formatGitError(pruneRes)}`)
    }
    return
  }
  const removeRes = await spawn({
    command: 'git',
    args: [
      'worktree',
      'remove',
      '--force',
      worktreeDir,
    ],
    cwd: root,
    signal,
  })
  if (removeRes.exitCode !== 0) {
    throw new Error(`Failed to remove worktree "${worktreeDir}": ${formatGitError(removeRes)}`)
  }
}

export function recordTeardown(records: TeardownRecord[]) {
  return async (ctx: RunLifecycleContext): Promise<void> => {
    records.push({
      runId: ctx.runId,
      workspaceRoot: ctx.workspaceRoot,
      aborted: ctx.signal.aborted,
    })
    await removeWorktree(ctx.workspaceRoot, ctx.runId, ctx.signal)
  }
}

export function buildWorktreeHarnessConfig(harnessName: string): HarnessConfig {
  return {
    name: harnessName,
    setup: async ({ runId, workspaceRoot, signal }) => ({
      cwd: await createWorktree(workspaceRoot, runId, signal),
      env: { WORKTREE_RUN: runId },
    }),
    teardown: async ({ runId, workspaceRoot, signal }) => {
      await removeWorktree(workspaceRoot, runId, signal)
    },
    env: ctx => ({
      DB_DATABASE: `test_run_${ctx.runId}`,
    }),
    steps: [
      {
        id: 'feature-step',
        afterStep: [
          execGuardrail({
            command: ['git', 'status', '--porcelain'],
            formatter: res => (
              res.exitCode === 0 && res.stdout.trim() === ''
                ? { status: 'pass' }
                : { status: 'fail', body: res.stdout || res.stderr }
            ),
          }),
        ],
        run: mockAgent({
          mode: 'workspace-write',
          prompt: 'Update app in isolated worktree',
          responses: [
            async (input) => {
              const appPath = path.join(input.cwd, 'src', 'app.ts')
              fs.writeFileSync(appPath, `export const app = "${input.ctx.runId}"\n`, 'utf-8')
              const check = await inspectSpawnEnv(input.cwd, input.env, ['DB_DATABASE', 'WORKTREE_RUN'])
              cp.execFileSync('git', ['add', 'src/app.ts'], { cwd: input.cwd })
              cp.execFileSync('git', ['commit', '-m', `feat: update app for ${input.ctx.runId}`], { cwd: input.cwd })
              return {
                runId: input.ctx.runId,
                observedCwd: check.cwd,
                observedDb: check.env.DB_DATABASE,
                observedWorktreeRun: check.env.WORKTREE_RUN,
              }
            },
          ],
        }),
      },
    ],
  }
}

export async function waitUntilFileExists(filePath: string, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!fs.existsSync(filePath) && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  expect(fs.existsSync(filePath)).toBe(true)
}

async function tryAbortAtGate(runDir: string, reason: string): Promise<boolean> {
  try {
    const client = await createControlClient(runDir)
    try {
      const state = await client.status()
      if (state.status === 'waiting_for_gate' && state.activeGate) {
        await client.abort({ reason, teardown: true })
        return true
      }
      return false
    }
    finally {
      await client.close()
    }
  }
  catch {
    return false
  }
}

export async function waitForGateAndAbort(runDir: string, reason: string): Promise<void> {
  for (let i = 0; i < 60; i++) {
    if (await tryAbortAtGate(runDir, reason)) {
      return
    }
    await new Promise(resolve => setTimeout(resolve, 40))
  }
  throw new Error('Timeout waiting for gate before IPC abort')
}

export async function seedGcRuns(
  workspaceDir: string,
  passedRunId: string,
  failedRunId: string,
  activeRunId: string,
): Promise<void> {
  const passedRes = await runHarness({
    name: 'epic-07-gc-passed',
    setup: async ({ runId, workspaceRoot, signal }) => ({
      cwd: await createWorktree(workspaceRoot, runId, signal),
    }),
    steps: [
      {
        id: 'ok',
        run: () => 'done',
      },
    ],
  }, { runId: passedRunId, workspaceDir })
  expect(passedRes.status).toBe('passed')

  const failedRes = await runHarness({
    name: 'epic-07-gc-failed',
    steps: [
      {
        id: 'boom',
        run: () => {
          throw new Error('fail for gc test')
        },
      },
    ],
  }, { runId: failedRunId, workspaceDir })
  expect(failedRes.status).toBe('failed')

  const activeRunDir = resolveRunDir(workspaceDir, activeRunId)
  writeRunStateAtomic(activeRunDir, {
    schemaVersion: 1,
    runId: activeRunId,
    harnessName: 'active-harness',
    workflowName: 'active-harness',
    status: 'running',
    activeStepId: 's1',
    steps: {},
    updatedAt: new Date().toISOString(),
  })
  fs.writeFileSync(path.join(activeRunDir, RUNNER_PID_FILE), `${process.pid}\n`, 'utf-8')
}
