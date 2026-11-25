import type { HarnessConfig, HostSpawnResult } from '../src/index.js'
import cp from 'node:child_process'
import fs from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { mockAgent } from '@luddjs/agents'
import { execGuardrail } from '@luddjs/guardrails'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { gc, runHarness, spawn } from '../src/index.js'

const RUN_ID_PATTERN = /^[\w.-]+$/
let tempDir: string

function validateRunId(runId: string): string {
  if (runId === '.' || runId === '..' || !RUN_ID_PATTERN.test(runId)) {
    throw new Error(`Invalid runId "${runId}" for worktree path.`)
  }
  return runId
}

function initTestGitRepo(dir: string): void {
  cp.execSync('git init', { cwd: dir })
  cp.execSync('git config user.name "Ludd E2E"', { cwd: dir })
  cp.execSync('git config user.email "e2e@luddjs.dev"', { cwd: dir })
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'src', 'app.ts'), '// initial base\nexport const app = "base"\n', 'utf-8')
  cp.execSync('git add .', { cwd: dir })
  cp.execSync('git commit -m "initial commit"', { cwd: dir })
}

function resolveWorktreeDir(workspaceRoot: string, runId: string): string {
  const root = path.resolve(workspaceRoot)
  return path.resolve(root, '.harness', 'worktrees', `${validateRunId(runId)}-feature-env`)
}

function formatGitError(result: HostSpawnResult): string {
  return result.stderr.trim() || result.stdout.trim() || `exit code ${result.exitCode ?? 'unknown'}`
}

async function createWorktree(workspaceRoot: string, runId: string, signal?: AbortSignal): Promise<string> {
  const root = path.resolve(workspaceRoot)
  const worktreeDir = resolveWorktreeDir(root, runId)
  fs.mkdirSync(path.dirname(worktreeDir), { recursive: true })
  const res = await spawn({
    command: 'git',
    args: [
      'worktree',
      'add',
      '-b',
      `ludd/${validateRunId(runId)}-feature-env`,
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

async function removeWorktree(workspaceRoot: string, runId: string, signal?: AbortSignal): Promise<void> {
  const root = path.resolve(workspaceRoot)
  const worktreeDir = resolveWorktreeDir(root, runId)
  if (fs.existsSync(worktreeDir)) {
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
    return
  }

  const pruneRes = await spawn({
    command: 'git',
    args: ['worktree', 'prune'],
    cwd: root,
    signal,
  })
  if (pruneRes.exitCode !== 0) {
    throw new Error(`Failed to prune worktrees: ${formatGitError(pruneRes)}`)
  }
}

function createSliceMockAgent() {
  return mockAgent({
    mode: 'workspace-write',
    prompt: 'Update app in isolated worktree',
    responses: [
      async (input) => {
        const appPath = path.join(input.cwd, 'src', 'app.ts')
        fs.writeFileSync(appPath, `export const app = "${input.ctx.runId}"\n`, 'utf-8')
        const checkRes = await spawn({
          command: process.execPath,
          args: ['-e', 'console.log("DB=" + process.env.DB_DATABASE)'],
          cwd: input.cwd,
          env: input.env,
        })
        expect(checkRes.exitCode).toBe(0)
        const addRes = await spawn({
          command: 'git',
          args: ['add', 'src/app.ts'],
          cwd: input.cwd,
        })
        expect(addRes.exitCode).toBe(0)
        const commitRes = await spawn({
          command: 'git',
          args: ['commit', '-m', `feat: update app for ${input.ctx.runId}`],
          cwd: input.cwd,
        })
        expect(commitRes.exitCode).toBe(0)
        return {
          runId: input.ctx.runId,
          observedDb: checkRes.stdout.trim(),
        }
      },
    ],
  })
}

function buildConcurrentHarnessConfig(harnessName: string): HarnessConfig {
  return {
    name: harnessName,
    setup: async ({ runId, workspaceRoot, signal }) => {
      const worktreeDir = await createWorktree(workspaceRoot, runId, signal)
      return { cwd: worktreeDir }
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
          }),
        ],
        run: createSliceMockAgent(),
      },
    ],
  }
}

describe('epic 7 E2E explicit host worktree isolation & gc', () => {
  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-e2e-epic7-'))
    initTestGitRepo(tempDir)
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('runs concurrent worktrees without lock collision and garbage collects on demand', async () => {
    const run1Id = 'e2e-wt-alpha'
    const run2Id = 'e2e-wt-beta'
    const config1 = buildConcurrentHarnessConfig('epic-07-alpha')
    const config2 = buildConcurrentHarnessConfig('epic-07-beta')

    const [res1, res2] = await Promise.all([
      runHarness(config1, { runId: run1Id, workspaceDir: tempDir }),
      runHarness(config2, { runId: run2Id, workspaceDir: tempDir }),
    ])

    expect(res1.status).toBe('passed')
    expect(res2.status).toBe('passed')

    const out1 = res1.steps['feature-step']?.output as { runId: string, observedDb: string }
    const out2 = res2.steps['feature-step']?.output as { runId: string, observedDb: string }
    expect(out1.observedDb).toBe('DB=test_run_e2e-wt-alpha')
    expect(out2.observedDb).toBe('DB=test_run_e2e-wt-beta')
    expect(out1.observedDb).not.toBe(out2.observedDb)

    const baseApp = fs.readFileSync(path.join(tempDir, 'src', 'app.ts'), 'utf-8')
    expect(baseApp).toContain('export const app = "base"')

    const wt1Dir = resolveWorktreeDir(tempDir, run1Id)
    const wt2Dir = resolveWorktreeDir(tempDir, run2Id)
    const run1Dir = path.join(tempDir, '.harness', 'runs', run1Id)
    const run2Dir = path.join(tempDir, '.harness', 'runs', run2Id)

    expect(fs.existsSync(wt1Dir)).toBe(true)
    expect(fs.existsSync(wt2Dir)).toBe(true)
    expect(fs.readFileSync(path.join(wt1Dir, 'src', 'app.ts'), 'utf-8')).toBe(`export const app = "${run1Id}"\n`)
    expect(fs.readFileSync(path.join(wt2Dir, 'src', 'app.ts'), 'utf-8')).toBe(`export const app = "${run2Id}"\n`)
    expect(fs.existsSync(run1Dir)).toBe(true)
    expect(fs.existsSync(run2Dir)).toBe(true)

    const gcResult = await gc({
      workspaceDir: tempDir,
      status: ['passed'],
    })
    expect(gcResult.cleanedRunIds).toContain(run1Id)
    expect(gcResult.cleanedRunIds).toContain(run2Id)
    expect(gcResult.skippedActiveRunIds).toEqual([])

    expect(fs.existsSync(wt1Dir)).toBe(true)
    expect(fs.existsSync(wt2Dir)).toBe(true)
    expect(fs.existsSync(run1Dir)).toBe(false)
    expect(fs.existsSync(run2Dir)).toBe(false)
  })

  it('guarantees DIY worktree teardown when a step fails', async () => {
    const runId = 'e2e-wt-teardown-fail'
    const wtDir = resolveWorktreeDir(tempDir, runId)

    const res = await runHarness({
      name: 'epic-07-teardown-fail',
      setup: async ({ runId: id, workspaceRoot, signal }) => {
        const cwd = await createWorktree(workspaceRoot, id, signal)
        return { cwd }
      },
      teardown: async ({ runId: id, workspaceRoot, signal }) => {
        await removeWorktree(workspaceRoot, id, signal)
      },
      steps: [
        {
          id: 'failing-step',
          run: () => {
            expect(fs.existsSync(wtDir)).toBe(true)
            throw new Error('simulated failure')
          },
        },
      ],
    }, { runId, workspaceDir: tempDir })

    expect(res.status).toBe('failed')
    expect(fs.existsSync(wtDir)).toBe(false)
  })
})
