import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  loadHarnessConfig,
  readLedgerEvents,
  readRunState,
  resolveRunDir,
  runHarness,
} from '../src/index.js'

let tempDir: string

beforeEach(() => {
  tempDir = mkdtempSync(path.join(os.tmpdir(), 'ludd-e2e-rehydrate-'))
})

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

async function writePipelineConfig(dir: string): Promise<string> {
  const filePath = path.join(dir, 'harness.config.ts')
  const escapedDir = dir.replaceAll('\\', '/')
  const content = [
    `import { defineHarness } from '@ludd/core'`,
    `import { z } from 'zod'`,
    `import fs from 'node:fs'`,
    `import path from 'node:path'`,
    `export default defineHarness({`,
    `  name: 'e2e-rehydration-pipeline',`,
    `  steps: [`,
    `    {`,
    `      id: 'step-1',`,
    `      outputSchema: z.object({ artifactKey: z.string(), score: z.number() }),`,
    `      run: async () => {`,
    `        fs.appendFileSync(path.join('${escapedDir}', 'step-1.log'), 'executed\\n', 'utf-8')`,
    `        return { artifactKey: 'spec-v1', score: 100 }`,
    `      },`,
    `    },`,
    `    {`,
    `      id: 'step-2',`,
    `      outputSchema: z.object({ verified: z.boolean(), fromStep1: z.string() }),`,
    `      run: async (ctx) => {`,
    `        const flag = path.join('${escapedDir}', 'crash-step-2.flag')`,
    `        if (fs.existsSync(flag)) {`,
    `          fs.rmSync(flag)`,
    `          throw new Error('Simulated runner crash in step-2')`,
    `        }`,
    `        const s1 = ctx.steps['step-1']?.output as { artifactKey: string }`,
    `        return { verified: true, fromStep1: s1.artifactKey }`,
    `      },`,
    `    },`,
    `    {`,
    `      id: 'step-3',`,
    `      outputSchema: z.object({ finalized: z.boolean() }),`,
    `      run: async (ctx) => {`,
    `        const s2 = ctx.steps['step-2']?.output as { verified: boolean }`,
    `        return { finalized: s2.verified }`,
    `      },`,
    `    },`,
    `  ],`,
    `})`,
  ].join('\n')

  await writeFile(filePath, content, 'utf-8')
  return filePath
}

function verifyLedgerEvents(runDir: string): void {
  const events = readLedgerEvents(runDir)
  expect(events.map(e => ({ type: e.eventType, stepId: e.stepId }))).toEqual([
    { type: 'run.started', stepId: null },
    { type: 'step.started', stepId: 'step-1' },
    { type: 'step.passed', stepId: 'step-1' },
    { type: 'step.started', stepId: 'step-2' },
    { type: 'step.failed', stepId: 'step-2' },
    { type: 'run.failed', stepId: null },
    { type: 'run.resumed', stepId: null },
    { type: 'step.started', stepId: 'step-2' },
    { type: 'step.passed', stepId: 'step-2' },
    { type: 'step.started', stepId: 'step-3' },
    { type: 'step.passed', stepId: 'step-3' },
    { type: 'run.passed', stepId: null },
  ])
}

function verifyRunState(runDir: string, runId: string): void {
  const state = readRunState(runDir)
  expect(state.schemaVersion).toBe(1)
  expect(state.runId).toBe(runId)
  expect(state.status).toBe('passed')
  expect(state.activeStepId).toBeNull()
  expect(state.steps['step-1']).toEqual({
    status: 'passed',
    output: { artifactKey: 'spec-v1', score: 100 },
  })
  expect(state.steps['step-2']).toEqual({
    status: 'passed',
    output: { verified: true, fromStep1: 'spec-v1' },
  })
  expect(state.steps['step-3']).toEqual({
    status: 'passed',
    output: { finalized: true },
  })
}

describe('epic 2 persistence rehydration E2E (crash recovery)', () => {
  it('recovers from step-2 crash, rehydrates state, skips step-1 and passes', async () => {
    const configPath = await writePipelineConfig(tempDir)
    const config = await loadHarnessConfig(configPath)
    const runId = 'e2e-crash-recovery-run'
    const runDir = resolveRunDir(tempDir, runId)
    const pidFile = path.join(runDir, 'runner.pid')

    await writeFile(path.join(tempDir, 'crash-step-2.flag'), 'crash', 'utf-8')

    const firstResult = await runHarness(config, { runId, workspaceDir: tempDir })
    expect(firstResult.status).toBe('failed')
    expect(firstResult.failedStepId).toBe('step-2')

    mkdirSync(runDir, { recursive: true })
    await writeFile(pidFile, '99999999\n', 'utf-8')
    expect(existsSync(pidFile)).toBe(true)

    const secondResult = await runHarness(config, { runId, workspaceDir: tempDir })
    expect(secondResult.status).toBe('passed')
    expect(secondResult.steps['step-1']?.status).toBe('passed')
    expect(secondResult.steps['step-2']?.status).toBe('passed')
    expect(secondResult.steps['step-3']?.status).toBe('passed')

    const step1Log = await readFile(path.join(tempDir, 'step-1.log'), 'utf-8')
    expect(step1Log.trim()).toBe('executed')
    expect(existsSync(pidFile)).toBe(false)

    verifyRunState(runDir, runId)
    verifyLedgerEvents(runDir)
  })
})
