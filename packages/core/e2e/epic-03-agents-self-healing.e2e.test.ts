import { mkdtempSync, rmSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  loadHarnessConfig,
  readLedgerEvents,
  readRunState,
  readStreamEvents,
  releaseRunPidLock,
  resolveRunDir,
  runHarness,
} from '../src/index.js'

let tempDir: string

beforeEach(() => {
  tempDir = mkdtempSync(path.join(os.tmpdir(), 'ludd-e2e-epic3-'))
})

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

function generateImplementStep(escapedDir: string): string {
  return [
    `    {`,
    `      id: 'implement',`,
    `      outputSchema: z.object({ commitMessage: z.string().min(5) }),`,
    `      maxTotalTurns: 5,`,
    `      run: mockAgent({`,
    `        mode: 'workspace-write',`,
    `        prompt: 'Implement bugfix and generate commit message',`,
    `        sessionId: (ctx) => (ctx.steps.triage?.output as { sessionId: string })?.sessionId,`,
    `        responses: [`,
    `          { commitMessage: 'fix' },`,
    `          async () => {`,
    `            const crashFlag = path.join('${escapedDir}', 'crash.flag')`,
    `            if (fs.existsSync(crashFlag)) {`,
    `              fs.rmSync(crashFlag)`,
    `              throw new Error('Simulated process crash in implement turn 2')`,
    `            }`,
    `            return { commitMessage: 'feat(core): implement self-healing agents' }`,
    `          },`,
    `          { commitMessage: 'feat(core): implement self-healing agents' },`,
    `        ],`,
    `      }),`,
    `    },`,
  ].join('\n')
}

function generateHarnessConfigContent(escapedDir: string): string {
  return [
    `import { defineHarness } from '@ludd/core'`,
    `import { mockAgent } from '@ludd/agents'`,
    `import { z } from 'zod'`,
    `import fs from 'node:fs'`,
    `import path from 'node:path'`,
    `export default defineHarness({`,
    `  name: 'epic-03-self-healing-pipeline',`,
    `  steps: [`,
    `    {`,
    `      id: 'triage',`,
    `      outputSchema: z.object({ issueType: z.string(), priority: z.number() }),`,
    `      run: mockAgent({`,
    `        mode: 'read-only',`,
    `        prompt: 'Triage incoming bug report',`,
    `        events: [`,
    `          { eventType: 'thought', payload: { reasoning: 'inspect stack trace' } },`,
    `        ],`,
    `        responses: [`,
    `          { issueType: 'bug', priority: 1 },`,
    `        ],`,
    `      }),`,
    `    },`,
    generateImplementStep(escapedDir),
    `    {`,
    `      id: 'verify',`,
    `      outputSchema: z.object({ verified: z.boolean(), summary: z.string() }),`,
    `      run: (ctx) => {`,
    `        const triage = ctx.steps.triage?.output as { issueType: string }`,
    `        const impl = ctx.steps.implement?.output as { commitMessage: string }`,
    `        return {`,
    `          verified: triage.issueType === 'bug' && impl.commitMessage.length >= 5,`,
    `          summary: \`Verified \${triage.issueType}: \${impl.commitMessage}\`,`,
    `        }`,
    `      },`,
    `    },`,
    `  ],`,
    `})`,
  ].join('\n')
}

async function writeEpic3Config(dir: string): Promise<string> {
  const filePath = path.join(dir, 'harness.config.ts')
  const escapedDir = dir.replaceAll('\\', '/')
  await writeFile(filePath, generateHarnessConfigContent(escapedDir), 'utf-8')
  return filePath
}

function verifyRunPersistence(runDir: string, triageSessionId: string): void {
  const finalState = readRunState(runDir)
  expect(finalState.status).toBe('passed')
  expect(finalState.activeStepId).toBeNull()
  expect(finalState.activeSessionId).toBeNull()
  expect(finalState.activeStepAttempt).toBe(1)
  expect(finalState.steps.triage.status).toBe('passed')
  expect(finalState.steps.implement.status).toBe('passed')
  expect(finalState.steps.verify.status).toBe('passed')

  const streamEvents = readStreamEvents(runDir, triageSessionId)
  expect(streamEvents.length).toBeGreaterThanOrEqual(5)
  expect(streamEvents.some(e => e.eventType === 'thought')).toBe(true)

  const ledgerEvents = readLedgerEvents(runDir)
  expect(ledgerEvents.some(e => e.eventType === 'step.retry')).toBe(true)
  expect(ledgerEvents.some(e => e.eventType === 'agent.stream.linked')).toBe(true)
}

describe('epic 3 self-healing agents and crash rehydration E2E (AC 3.5.4)', () => {
  it('executes triage, crashes on implement turn 2, resumes with same sessionId, self-heals, and passes', async () => {
    const configPath = await writeEpic3Config(tempDir)
    const config = await loadHarnessConfig(configPath)
    const runId = 'e2e-epic-03-run'
    const runDir = resolveRunDir(tempDir, runId)
    const crashFlag = path.join(tempDir, 'crash.flag')

    await writeFile(crashFlag, 'crash-now', 'utf-8')

    const firstRun = await runHarness(config, { runId, workspaceDir: tempDir })
    expect(firstRun.status).toBe('failed')
    expect(firstRun.failedStepId).toBe('implement')

    const midState = readRunState(runDir)
    expect(midState.steps.triage?.status).toBe('passed')
    const triageSessionId = (midState.steps.triage?.output as { sessionId: string }).sessionId
    expect(triageSessionId).toMatch(/^session-[0-9a-f-]+$/)

    releaseRunPidLock(runDir)

    const secondRun = await runHarness(config, { runId, workspaceDir: tempDir })
    expect(secondRun.status).toBe('passed')
    expect(secondRun.steps.triage?.status).toBe('passed')
    expect(secondRun.steps.implement?.status).toBe('passed')
    expect(secondRun.steps.verify?.status).toBe('passed')

    const implOutput = secondRun.steps.implement?.output as { commitMessage: string, sessionId: string }
    expect(implOutput.commitMessage).toBe('feat(core): implement self-healing agents')
    expect(implOutput.sessionId).toBe(triageSessionId)

    verifyRunPersistence(runDir, triageSessionId)
  })
})
