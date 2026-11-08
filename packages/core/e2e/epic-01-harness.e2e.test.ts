import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadHarnessConfig, runHarness, StepOutputValidationError } from '../src/index.js'

let tempDir: string

async function writeValidHarnessConfig(dir: string): Promise<string> {
  const filePath = path.join(dir, 'harness.config.ts')
  const content = [
    `import { defineHarness, resolveDynamicProperty } from '@ludd/core'`,
    `import { z } from 'zod'`,
    `const planSchema = z.object({ action: z.string(), priority: z.enum(['low', 'high']) })`,
    `const resultSchema = z.object({ applied: z.boolean(), prompt: z.string() })`,
    `export default defineHarness({`,
    `  name: 'epic-01-vertical-workflow',`,
    `  cleanupPolicy: { onSuccess: 'keep', onFailure: 'destroy' },`,
    `  steps: [`,
    `    {`,
    `      id: 'plan-step',`,
    `      outputSchema: planSchema,`,
    `      run: async () => ({ action: 'apply', priority: 'high' }),`,
    `    },`,
    `    {`,
    `      id: 'agent-step',`,
    `      if: (ctx) => (ctx.steps['plan-step']?.output as { priority?: string })?.priority === 'high',`,
    `      outputSchema: resultSchema,`,
    `      run: {`,
    `        __kind: 'agent',`,
    `        mode: 'read-only',`,
    `        prompt: (ctx: any) => \`Run:\${ctx.runId}\`,`,
    `        executeTurn: async (turn: any) => ({`,
    `          output: { applied: true, prompt: turn.prompt },`,
    `          sessionId: turn.sessionId,`,
    `        }),`,
    `      },`,
    `    },`,
    `    {`,
    `      id: 'skipped-step',`,
    `      if: (ctx) => (ctx.steps['plan-step']?.output as { priority?: string })?.priority === 'low',`,
    `      run: async () => ({ escalated: true }),`,
    `    },`,
    `  ],`,
    `})`,
  ].join('\n')

  await writeFile(filePath, content)
  return filePath
}

async function writeInvalidOutputHarnessConfig(dir: string): Promise<string> {
  const filePath = path.join(dir, 'invalid-output.config.ts')
  const content = [
    `import { defineHarness } from '@ludd/core'`,
    `import { z } from 'zod'`,
    `export default defineHarness({`,
    `  name: 'failing-schema-workflow',`,
    `  steps: [{`,
    `    id: 'strict-step',`,
    `    outputSchema: z.object({ requiredScore: z.number() }),`,
    `    run: async () => ({ requiredScore: 'not-a-number' }),`,
    `  }],`,
    `})`,
  ].join('\n')

  await writeFile(filePath, content)
  return filePath
}

describe('epic 1 E2E vertical workflow execution', () => {
  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-e2e-harness-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('runs complete vertical flow from file to executed steps', async () => {
    const configPath = await writeValidHarnessConfig(tempDir)
    const config = await loadHarnessConfig(configPath)

    expect(config.name).toBe('epic-01-vertical-workflow')
    expect(config.steps).toHaveLength(3)

    const result = await runHarness(config, { runId: 'run-e2e-100', workspaceDir: tempDir })

    expect(result.status).toBe('passed')
    expect(result.runId).toBe('run-e2e-100')
    expect(result.steps['plan-step']?.status).toBe('passed')
    expect(result.steps['plan-step']?.output).toEqual({ action: 'apply', priority: 'high' })
    expect(result.steps['agent-step']?.status).toBe('passed')
    expect(result.steps['agent-step']?.output).toEqual({ applied: true, prompt: 'Run:run-e2e-100' })
    expect(result.steps['skipped-step']?.status).toBe('skipped')
    expect(result.steps['skipped-step']?.output).toBeUndefined()
  })

  it('captures step output schema validation failure in loaded workflow', async () => {
    const configPath = await writeInvalidOutputHarnessConfig(tempDir)
    const config = await loadHarnessConfig(configPath)
    const result = await runHarness(config, { runId: 'run-e2e-fail', workspaceDir: tempDir })

    expect(result.status).toBe('failed')
    expect(result.failedStepId).toBe('strict-step')
    expect(result.error).toBeInstanceOf(StepOutputValidationError)
    expect(result.steps['strict-step']?.status).toBe('failed')
  })
})
