import type { HarnessRunResult } from '../src/index.js'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  loadHarnessConfig,
  readLedgerEvents,
  readRunState,
  releaseRunPidLock,
  resolveRunDir,
  runHarness,
} from '../src/index.js'

let tempDir: string

beforeEach(() => {
  tempDir = mkdtempSync(path.join(os.tmpdir(), 'ludd-e2e-epic4-'))
})

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

function generateSpecStepContent(): string {
  return [
    `    {`,
    `      id: 'generate-spec-and-todos',`,
    `      artifacts: {`,
    `        'spec.md': { nonEmpty: true },`,
    `        'todos.json': { schema: TodosArtifactSchema },`,
    `      },`,
    `      maxTotalTurns: 5,`,
    `      run: mockAgent({`,
    `        mode: 'workspace-write',`,
    `        prompt: 'Generate specification and slice breakdown',`,
    `        sessionId: (ctx) => (ctx.steps['triage-and-grilling']?.output as { sessionId: string })?.sessionId,`,
    `        responses: [`,
    `          async (input) => {`,
    `            await putArtifactViaMcp(input.mcpServerUrl, input.mcpAuthToken, 'spec.md', '# Feature Spec')`,
    `            return { output: 'wrote-spec-only' }`,
    `          },`,
    `          async (input) => {`,
    `            await putArtifactViaMcp(input.mcpServerUrl, input.mcpAuthToken, 'spec.md', '# Feature Spec\\n\\nFull spec')`,
    `            const todos = [`,
    `              { id: 'slice-1', title: 'Data Model', description: 'Models', acceptanceCriteria: ['AC1'] },`,
    `              { id: 'slice-2', title: 'API Endpoints', description: 'Endpoints', acceptanceCriteria: ['AC2'] },`,
    `              { id: 'slice-3', title: 'UI Integration', description: 'Views', acceptanceCriteria: ['AC3'] },`,
    `            ]`,
    `            await putArtifactViaMcp(input.mcpServerUrl, input.mcpAuthToken, 'todos.json', JSON.stringify(todos))`,
    `            return { output: 'wrote-all-artifacts' }`,
    `          },`,
    `        ],`,
    `      }),`,
    `    },`,
  ].join('\n')
}

function generateImplementStepContent(escapedDir: string): string {
  return [
    `    {`,
    `      id: 'implement-slices',`,
    `      matrix: { itemsFromArtifact: 'todos.json' },`,
    `      outputSchema: z.object({ commitMessage: z.string().min(5) }),`,
    `      maxTotalTurns: 5,`,
    `      run: mockAgent({`,
    `        mode: 'workspace-write',`,
    `        prompt: (ctx) => \`Implement \${ctx.matrix.index + 1}/\${ctx.matrix.total}: \${ctx.matrix.item.title}\`,`,
    `        responses: [`,
    `          async (input) => handleSliceExecution(input, '${escapedDir}'),`,
    `          async (input) => handleSliceExecution(input, '${escapedDir}'),`,
    `          async (input) => handleSliceExecution(input, '${escapedDir}'),`,
    `          async (input) => handleSliceExecution(input, '${escapedDir}'),`,
    `        ],`,
    `      }),`,
    `    },`,
  ].join('\n')
}

function generateReviewStepContent(): string {
  return [
    `    {`,
    `      id: 'final-review-and-pr',`,
    `      if: (ctx) => ctx.steps['implement-slices']?.status === 'passed',`,
    `      artifacts: { 'pr-description.md': { nonEmpty: true } },`,
    `      run: async (ctx) => {`,
    `        const slices = ctx.steps['implement-slices']?.output as Array<{ commitMessage: string }>`,
    `        const summary = slices.map(s => \`- \${s.commitMessage}\`).join('\\n')`,
    `        await ctx.artifacts.put('pr-description.md', \`# Pull Request\\n\\n\${summary}\\n\`)`,
    `        return { prCreated: true, summary }`,
    `      },`,
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
    `const TodoSliceSchema = z.object({ id: z.string(), title: z.string(), description: z.string(), acceptanceCriteria: z.array(z.string()) })`,
    `const TodosArtifactSchema = z.array(TodoSliceSchema).min(1)`,
    `async function putArtifactViaMcp(url: string, token: string, key: string, content: string) {`,
    `  return (await fetch(url, {`,
    `    method: 'POST',`,
    `    headers: { 'Content-Type': 'application/json', Authorization: \`Bearer \${token}\` },`,
    `    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'put_artifact', arguments: { key, content } } }),`,
    `  })).json()`,
    `}`,
    `async function handleSliceExecution(input: any, dir: string) {`,
    `  const idx = input.ctx.matrix.index`,
    `  fs.appendFileSync(path.join(dir, 'executed-slices.log'), \`slice-\${idx}\\n\`)`,
    `  if (idx === 1) {`,
    `    const flag = path.join(dir, 'crash.flag')`,
    `    if (fs.existsSync(flag)) {`,
    `      fs.rmSync(flag)`,
    `      throw new Error('Simulated process crash mid-Slice 1')`,
    `    }`,
    `  }`,
    `  return { commitMessage: \`feat: implement slice-\${idx + 1}\` }`,
    `}`,
    `export default defineHarness({`,
    `  name: 'epic-04-matrix-mcp-pipeline',`,
    `  steps: [`,
    `    {`,
    `      id: 'triage-and-grilling',`,
    `      outputSchema: z.object({ status: z.enum(['needs_clarification', 'ready']), questions: z.array(z.string()), summary: z.string() }),`,
    `      run: mockAgent({`,
    `        mode: 'read-only',`,
    `        prompt: 'Analyze feature request',`,
    `        responses: [{ status: 'ready', questions: [], summary: 'Implement 3 vertical slices' }],`,
    `      }),`,
    `    },`,
    generateSpecStepContent(),
    generateImplementStepContent(escapedDir),
    generateReviewStepContent(),
    `  ],`,
    `})`,
  ].join('\n')
}

async function writeEpic4Config(dir: string): Promise<string> {
  const filePath = path.join(dir, 'harness.config.ts')
  const escapedDir = dir.replaceAll('\\', '/')
  await writeFile(filePath, generateHarnessConfigContent(escapedDir), 'utf-8')
  return filePath
}

function verifyFirstRun(firstRun: HarnessRunResult, runDir: string): { triageSessionId: string, slice1SessionId: string } {
  expect(firstRun.status).toBe('failed')
  expect(firstRun.failedStepId).toBe('implement-slices')

  const midState = readRunState(runDir)
  expect(midState.steps['triage-and-grilling']?.status).toBe('passed')
  expect(midState.steps['generate-spec-and-todos']?.status).toBe('passed')
  expect(midState.activeMatrixIndex).toBe(1)
  expect(midState.activeMatrixOutputs).toHaveLength(1)
  expect(midState.activeSessionId).toBeDefined()
  expect(midState.activeSessionId).not.toBeNull()

  const triageSessionId = (midState.steps['triage-and-grilling']?.output as { sessionId: string }).sessionId
  expect(triageSessionId).toMatch(/^session-[0-9a-f-]+$/)
  const slice1SessionId = midState.activeSessionId as string
  return { triageSessionId, slice1SessionId }
}

function verifySecondRun(
  secondRun: HarnessRunResult,
  runDir: string,
  dir: string,
  sessions: { triageSessionId: string, slice1SessionId: string },
): void {
  expect(secondRun.status).toBe('passed')
  expect(secondRun.steps['triage-and-grilling']?.status).toBe('passed')
  expect(secondRun.steps['generate-spec-and-todos']?.status).toBe('passed')
  expect(secondRun.steps['implement-slices']?.status).toBe('passed')
  expect(secondRun.steps['final-review-and-pr']?.status).toBe('passed')

  const specSession = (secondRun.steps['generate-spec-and-todos']?.output as { sessionId: string }).sessionId
  expect(specSession).toBe(sessions.triageSessionId)

  const sliceOutputs = secondRun.steps['implement-slices']?.output as Array<{ commitMessage: string, sessionId: string }>
  expect(sliceOutputs).toHaveLength(3)
  expect(sliceOutputs[0].commitMessage).toBe('feat: implement slice-1')
  expect(sliceOutputs[1].commitMessage).toBe('feat: implement slice-2')
  expect(sliceOutputs[2].commitMessage).toBe('feat: implement slice-3')
  expect(sliceOutputs[1].sessionId).toBe(sessions.slice1SessionId)
  expect(sliceOutputs[2].sessionId).not.toBe(sessions.slice1SessionId)

  const sliceLog = readFileSync(path.join(dir, 'executed-slices.log'), 'utf-8').trim().split('\n')
  expect(sliceLog).toEqual([
    'slice-0',
    'slice-1',
    'slice-1',
    'slice-2',
  ])

  const finalState = readRunState(runDir)
  expect(finalState.status).toBe('passed')
  expect(finalState.activeStepId).toBeNull()
  expect(finalState.activeMatrixIndex).toBeNull()
  expect(finalState.activeMatrixOutputs).toEqual([])

  const prDesc = readFileSync(path.join(runDir, 'artifacts', 'pr-description.md'), 'utf-8')
  expect(prDesc).toContain('feat: implement slice-1')
  expect(prDesc).toContain('feat: implement slice-2')
  expect(prDesc).toContain('feat: implement slice-3')

  const ledger = readLedgerEvents(runDir)
  expect(ledger.some(e => e.eventType === 'step.retry')).toBe(true)
  expect(ledger.some(e => e.matrixIndex === 0)).toBe(true)
  expect(ledger.some(e => e.matrixIndex === 1)).toBe(true)
  expect(ledger.some(e => e.matrixIndex === 2)).toBe(true)
}

describe('epic 4 full-loop MCP artifacts matrix workflow E2E (AC 4.5.4 & AC 4.5.5)', () => {
  it('executes 4-step pipeline, self-heals artifacts, recovers mid-matrix, and completes PR', async () => {
    const configPath = await writeEpic4Config(tempDir)
    const config = await loadHarnessConfig(configPath)
    const runId = 'e2e-epic-04-run'
    const runDir = resolveRunDir(tempDir, runId)
    const crashFlag = path.join(tempDir, 'crash.flag')

    await writeFile(crashFlag, 'crash-slice-1', 'utf-8')

    const firstRun = await runHarness(config, { runId, workspaceDir: tempDir })
    const sessions = verifyFirstRun(firstRun, runDir)

    releaseRunPidLock(runDir)

    const secondRun = await runHarness(config, { runId, workspaceDir: tempDir })
    verifySecondRun(secondRun, runDir, tempDir, sessions)
  })
})
