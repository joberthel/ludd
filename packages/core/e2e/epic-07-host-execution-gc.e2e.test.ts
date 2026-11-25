import type { ObservedExecution } from './epic-07-env-helpers.js'
import type { TeardownRecord } from './epic-07-helpers.js'
import cp from 'node:child_process'
import fs from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { mockAgent } from '@luddjs/agents'
import { humanReviewGuardrail } from '@luddjs/guardrails'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { gc, resolveRunDir, runHarness, spawn } from '../src/index.js'
import {
  assertPrecedenceObservations,
  buildPrecedenceHarnessConfig,
  createEnvInspectorGuardrail,
  createPrecedenceWorkspace,
  ENV_KEYS,
} from './epic-07-env-helpers.js'
import {
  buildWorktreeHarnessConfig,
  createWorktree,
  initTestGitRepo,
  recordTeardown,
  resolveBranchName,
  resolveWorktreeDir,
  seedGcRuns,
  waitForGateAndAbort,
  waitUntilFileExists,
} from './epic-07-helpers.js'

let tempDir: string

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-e2e-epic7-'))
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

it('resolves static and dynamic cwd/env across harness, setup, steps, and guardrails', async () => {
  const dirs = createPrecedenceWorkspace(tempDir)
  const observations: ObservedExecution[] = []
  const res1 = await runHarness(buildPrecedenceHarnessConfig(ENV_KEYS, observations), {
    runId: 'run-a',
    workspaceDir: tempDir,
  })
  expect(res1.status).toBe('passed')
  assertPrecedenceObservations(observations, dirs)

  const res2Observations: ObservedExecution[] = []
  const res2 = await runHarness({
    name: 'epic-07-dynamic-harness-cwd',
    cwd: async ctx => `dyn-harness-${ctx.runId}`,
    env: { SCOPE: 'harness-static', SHARED: 'static' },
    setup: async () => {},
    steps: [
      {
        id: 'verify',
        beforeStep: [
          createEnvInspectorGuardrail(ENV_KEYS, res2Observations),
        ],
        run: () => 'ok',
      },
    ],
  }, { runId: 'run-b', workspaceDir: tempDir })

  expect(res2.status).toBe('passed')
  expect(res2Observations).toEqual([
    {
      cwd: fs.realpathSync(dirs.dynamicHarnessDir),
      env: { SCOPE: 'harness-static', SHARED: 'static' },
    },
  ])
})

it('isolates concurrent DIY Git worktree runs by runId and tears down after completion', async () => {
  initTestGitRepo(tempDir)
  const run1Id = 'e2e-wt-alpha'
  const run2Id = 'e2e-wt-beta'
  const realTempDir = fs.realpathSync(tempDir)
  const expectedWt1 = resolveWorktreeDir(realTempDir, run1Id)
  const expectedWt2 = resolveWorktreeDir(realTempDir, run2Id)

  const [res1, res2] = await Promise.all([
    runHarness(buildWorktreeHarnessConfig('epic-07-alpha'), { runId: run1Id, workspaceDir: tempDir }),
    runHarness(buildWorktreeHarnessConfig('epic-07-beta'), { runId: run2Id, workspaceDir: tempDir }),
  ])

  expect(res1.status).toBe('passed')
  expect(res2.status).toBe('passed')
  expect(res1.steps['feature-step']?.output).toMatchObject({
    runId: run1Id,
    observedCwd: expectedWt1,
    observedDb: `test_run_${run1Id}`,
    observedWorktreeRun: run1Id,
  })
  expect(res2.steps['feature-step']?.output).toMatchObject({
    runId: run2Id,
    observedCwd: expectedWt2,
    observedDb: `test_run_${run2Id}`,
    observedWorktreeRun: run2Id,
  })
  expect(fs.readFileSync(path.join(tempDir, 'src', 'app.ts'), 'utf-8')).toContain('export const app = "base"')
  expect(fs.existsSync(resolveWorktreeDir(tempDir, run1Id))).toBe(false)
  expect(fs.existsSync(resolveWorktreeDir(tempDir, run2Id))).toBe(false)
  expect(cp.execFileSync('git', ['show', `${resolveBranchName(run1Id)}:src/app.ts`], {
    cwd: tempDir,
    encoding: 'utf-8',
  })).toBe(`export const app = "${run1Id}"\n`)
  expect(cp.execFileSync('git', ['show', `${resolveBranchName(run2Id)}:src/app.ts`], {
    cwd: tempDir,
    encoding: 'utf-8',
  })).toBe(`export const app = "${run2Id}"\n`)
})

it('guarantees non-aborted teardown when a step fails', async () => {
  initTestGitRepo(tempDir)
  const failRunId = 'e2e-td-fail'
  const records: TeardownRecord[] = []
  const wtDir = resolveWorktreeDir(tempDir, failRunId)
  const res = await runHarness({
    name: 'epic-07-td-fail',
    setup: async ({ runId, workspaceRoot, signal }) => ({
      cwd: await createWorktree(workspaceRoot, runId, signal),
    }),
    teardown: recordTeardown(records),
    steps: [
      {
        id: 'fail-step',
        run: () => {
          expect(fs.existsSync(wtDir)).toBe(true)
          throw new Error('simulated failure')
        },
      },
    ],
  }, { runId: failRunId, workspaceDir: tempDir })

  expect(res.status).toBe('failed')
  expect(records).toEqual([
    { runId: failRunId, workspaceRoot: tempDir, aborted: false },
  ])
  expect(fs.existsSync(wtDir)).toBe(false)
})

it('guarantees non-aborted teardown on AbortSignal cancellation', async () => {
  initTestGitRepo(tempDir)
  const sigRunId = 'e2e-td-signal'
  const records: TeardownRecord[] = []
  const wtDir = resolveWorktreeDir(tempDir, sigRunId)
  const readyFile = path.join(tempDir, 'child-ready.flag')
  const abortCtrl = new AbortController()
  const runPromise = runHarness({
    name: 'epic-07-td-signal',
    setup: async ({ runId, workspaceRoot, signal }) => ({
      cwd: await createWorktree(workspaceRoot, runId, signal),
    }),
    teardown: recordTeardown(records),
    steps: [
      {
        id: 'long-step',
        run: mockAgent({
          mode: 'workspace-write',
          prompt: 'Run cancellable command',
          responses: [
            async (input) => {
              await spawn({
                command: process.execPath,
                args: [
                  '-e',
                  `require('node:fs').writeFileSync(${JSON.stringify(readyFile)}, '1'); setInterval(() => {}, 1000)`,
                ],
                cwd: input.cwd,
                signal: input.signal,
              })
              return 'never'
            },
          ],
        }),
      },
    ],
  }, { runId: sigRunId, workspaceDir: tempDir, signal: abortCtrl.signal })

  await waitUntilFileExists(readyFile)
  expect(fs.existsSync(wtDir)).toBe(true)
  abortCtrl.abort(new Error('AbortSignal cancelled'))

  const res = await runPromise
  expect(res.status).toBe('failed')
  expect(records).toEqual([
    { runId: sigRunId, workspaceRoot: tempDir, aborted: false },
  ])
  expect(fs.existsSync(wtDir)).toBe(false)
})

it('guarantees non-aborted teardown on IPC run.abort (ludd abort)', async () => {
  initTestGitRepo(tempDir)
  const ipcRunId = 'e2e-td-ipc'
  const records: TeardownRecord[] = []
  const wtDir = resolveWorktreeDir(tempDir, ipcRunId)
  const runDir = resolveRunDir(tempDir, ipcRunId)
  const runPromise = runHarness({
    name: 'epic-07-td-ipc',
    setup: async ({ runId, workspaceRoot, signal }) => ({
      cwd: await createWorktree(workspaceRoot, runId, signal),
    }),
    teardown: recordTeardown(records),
    steps: [
      {
        id: 'gate-step',
        beforeStep: [
          humanReviewGuardrail({ prompt: 'Approve?' }),
        ],
        run: () => 'ok',
      },
    ],
  }, { runId: ipcRunId, workspaceDir: tempDir })

  await waitForGateAndAbort(runDir, 'ludd abort teardown test')
  const res = await runPromise
  expect(res.status).toBe('failed')
  expect(records).toEqual([
    { runId: ipcRunId, workspaceRoot: tempDir, aborted: false },
  ])
  expect(fs.existsSync(wtDir)).toBe(false)
})

it('prunes .harness/runs/* via filesystem-only gc() while leaving external directories untouched', async () => {
  initTestGitRepo(tempDir)
  const passedRunId = 'e2e-gc-passed'
  const failedRunId = 'e2e-gc-failed'
  const activeRunId = 'e2e-gc-active'
  const externalFile = path.join(tempDir, 'external-artifacts', 'keep.txt')
  fs.mkdirSync(path.dirname(externalFile), { recursive: true })
  fs.writeFileSync(externalFile, 'keep-me', 'utf-8')
  await seedGcRuns(tempDir, passedRunId, failedRunId, activeRunId)

  const keptWtDir = resolveWorktreeDir(tempDir, passedRunId)
  const passedRunDir = resolveRunDir(tempDir, passedRunId)
  const failedRunDir = resolveRunDir(tempDir, failedRunId)
  const activeRunDir = resolveRunDir(tempDir, activeRunId)

  const gcPassed = await gc({
    workspaceDir: tempDir,
    status: ['passed'],
  })
  expect(gcPassed).toEqual({
    cleanedRunIds: [passedRunId],
    skippedActiveRunIds: [],
  })
  expect(fs.existsSync(passedRunDir)).toBe(false)
  expect(fs.existsSync(failedRunDir)).toBe(true)
  expect(fs.existsSync(keptWtDir)).toBe(true)
  expect(fs.readFileSync(externalFile, 'utf-8')).toBe('keep-me')

  const gcAll = await gc({ workspaceDir: tempDir })
  expect(gcAll).toEqual({
    cleanedRunIds: [failedRunId],
    skippedActiveRunIds: [activeRunId],
  })
  expect(fs.existsSync(failedRunDir)).toBe(false)
  expect(fs.existsSync(activeRunDir)).toBe(true)
  expect(fs.existsSync(keptWtDir)).toBe(true)
  expect(fs.readFileSync(externalFile, 'utf-8')).toBe('keep-me')
})
