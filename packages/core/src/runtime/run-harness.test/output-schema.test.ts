import type { StepConfig } from '../../types/harness.js'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { StepOutputValidationError } from '../../errors/step-output-validation-error.js'
import { runHarness } from '../run-harness.js'

describe('runHarness outputSchema transform and defaults', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-out-schema-'))
  })
  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('applies defaults and transforms to step and context on success', async () => {
    const schema = z.object({
      title: z.string().transform(v => v.trim().toUpperCase()),
      count: z.number().default(42),
    })
    let downstreamSeen: unknown
    const result = await runHarness({
      name: 'schema-success',
      steps: [
        {
          id: 'step-1',
          outputSchema: schema,
          run: () => ({ title: '  hello  ' }),
        },
        {
          id: 'step-2',
          run: (ctx) => {
            downstreamSeen = ctx.steps['step-1']?.output
            return 'done'
          },
        },
      ],
    }, { workspaceDir: tempDir })
    expect(result.status).toBe('passed')
    expect(result.steps['step-1']?.output).toEqual({ title: 'HELLO', count: 42 })
    expect(downstreamSeen).toEqual({ title: 'HELLO', count: 42 })
    expect(result.steps['step-2']?.output).toBe('done')
  })
})

describe('runHarness outputSchema agent runner validation', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-out-agent-'))
  })
  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('validates agent runner output against outputSchema', async () => {
    const schema = z.object({
      score: z.number(),
    })
    const result = await runHarness({
      name: 'agent-schema',
      steps: [
        {
          id: 'agent-step',
          outputSchema: schema,
          run: {
            __kind: 'agent',
            execute: async () => ({ score: 100 }),
          },
        },
      ],
    }, { workspaceDir: tempDir })
    expect(result.status).toBe('passed')
    expect(result.steps['agent-step']?.output).toEqual({ score: 100 })
  })
})

describe('runHarness outputSchema validation failure', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-out-fail-'))
  })
  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('fails step and halts pipeline with StepOutputValidationError on violation', async () => {
    const schema = z.object({
      commitMessage: z.string().min(5),
      status: z.enum(['ready', 'needs_clarification']),
    })
    let downstreamCalled = false
    const rawBad = { commitMessage: 'fix', status: 'invalid' }
    const result = await runHarness({
      name: 'schema-fail',
      steps: [
        {
          id: 'implement-slices',
          outputSchema: schema,
          run: () => rawBad,
        } as StepConfig,
        {
          id: 'downstream',
          run: () => {
            downstreamCalled = true
          },
        },
      ],
    }, { workspaceDir: tempDir })
    expect(downstreamCalled).toBe(false)
    expect(result.status).toBe('failed')
    expect(result.failedStepId).toBe('implement-slices')
    expect(result.steps['implement-slices']).toEqual({ status: 'failed', output: undefined })
    expect(result.error).toBeInstanceOf(StepOutputValidationError)
  })
})
