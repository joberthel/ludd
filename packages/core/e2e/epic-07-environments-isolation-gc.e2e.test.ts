import type { HarnessConfig, StepContext } from '../src/index.js'
import cp from 'node:child_process'
import fs from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { gitWorktreeEnv } from '@ludd/environments'
import { execGuardrail } from '@ludd/guardrails'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { gc, runHarness } from '../src/index.js'

let tempDir: string

function initTestGitRepo(dir: string): void {
  cp.execSync('git init', { cwd: dir })
  cp.execSync('git config user.name "Ludd E2E"', { cwd: dir })
  cp.execSync('git config user.email "e2e@ludd.dev"', { cwd: dir })
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'src', 'app.ts'), '// initial base\nexport const app = "base"\n', 'utf-8')
  cp.execSync('git add .', { cwd: dir })
  cp.execSync('git commit -m "initial commit"', { cwd: dir })
}

function buildConcurrentHarnessConfig(harnessName: string): HarnessConfig {
  return {
    name: harnessName,
    cleanupPolicy: { onSuccess: 'keep', onFailure: 'keep' },
    steps: [
      {
        id: 'feature-step',
        environment: gitWorktreeEnv({
          id: 'feature-env',
          env: (ctx: StepContext) => ({
            DB_DATABASE: `test_run_${ctx.runId}`,
          }),
        }),
        afterStep: [
          execGuardrail({
            command: ['git', 'status', '--porcelain'],
          }),
        ],
        run: async (ctx: StepContext) => {
          const env = ctx.environments['feature-env']
          const appPath = path.join(env.workingDir, 'src', 'app.ts')
          fs.writeFileSync(appPath, `export const app = "${ctx.runId}"\n`, 'utf-8')
          const checkRes = await env.exec(['node', '-e', 'console.log("DB=" + process.env.DB_DATABASE)'])
          await env.exec(['git', 'add', 'src/app.ts'])
          await env.exec([
            'git',
            'commit',
            '-m',
            `feat: update app for ${ctx.runId}`,
          ])
          return {
            runId: ctx.runId,
            observedDb: checkRes.stdout.trim(),
          }
        },
      },
    ],
  }
}

describe('epic 7 E2E environments isolation & gc (AC 7.6)', () => {
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

    const wt1Dir = path.join(tempDir, '.harness', 'worktrees', `${run1Id}-feature-env`)
    const wt2Dir = path.join(tempDir, '.harness', 'worktrees', `${run2Id}-feature-env`)
    const run1Dir = path.join(tempDir, '.harness', 'runs', run1Id)
    const run2Dir = path.join(tempDir, '.harness', 'runs', run2Id)

    expect(fs.existsSync(wt1Dir)).toBe(true)
    expect(fs.existsSync(wt2Dir)).toBe(true)
    expect(fs.existsSync(run1Dir)).toBe(true)
    expect(fs.existsSync(run2Dir)).toBe(true)

    const gcResult = await gc({
      workspaceDir: tempDir,
      status: ['passed'],
    })
    expect(gcResult.cleanedRunIds).toContain(run1Id)
    expect(gcResult.cleanedRunIds).toContain(run2Id)
    expect(gcResult.skippedActiveRunIds).toEqual([])

    expect(fs.existsSync(wt1Dir)).toBe(false)
    expect(fs.existsSync(wt2Dir)).toBe(false)
    expect(fs.existsSync(run1Dir)).toBe(false)
    expect(fs.existsSync(run2Dir)).toBe(false)
  })
})
