import type { AgentRunner, AgentTurnInput } from '../../types/agent.js'
import type { Guardrail } from '../../types/guardrail.js'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { GuardrailMaxRetriesExceededError } from '../../errors/guardrail-max-retries-exceeded-error.js'
import { MaxTotalTurnsExceededError } from '../../errors/max-total-turns-exceeded-error.js'
import { readRunState, resolveRunDir } from '../../persistence/state-store.js'
import { runHarness } from '../run-harness.js'

let tempDir: string

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-after-step-'))
})
afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

function makeTestAgent(outputs: readonly { code: string }[]): AgentRunner<{ code: string }> {
  let callCount = 0
  return {
    __kind: 'agent',
    mode: 'workspace-write',
    prompt: 'Write code',
    executeTurn: async (input: AgentTurnInput) => {
      const output = outputs[callCount] ?? outputs[outputs.length - 1]
      callCount += 1
      return { output, sessionId: input.sessionId }
    },
  }
}

describe('afterStep guardrails state persistence (AC 5.1.3)', () => {
  it('persists activeGuardrailRetries in state.json and resets on step completion', async () => {
    let capturedRetriesDuringRetry: Record<string, number> | undefined
    let runDir = ''
    const rail: Guardrail = {
      __kind: 'guardrail',
      type: 'fn',
      maxRetries: 2,
      execute: async (input) => {
        if (input.attempt === 1) {
          return { status: 'fail', body: 'first try fail' }
        }
        runDir = input.runDir
        capturedRetriesDuringRetry = readRunState(runDir).activeGuardrailRetries
        return { status: 'pass' }
      },
    }

    const agent = makeTestAgent([
      { code: 't1' },
      { code: 't2' },
    ])
    const result = await runHarness({
      name: 'state-persistence-test',
      steps: [
        {
          id: 's1',
          run: agent,
          afterStep: [rail],
        },
        {
          id: 's2',
          run: async () => ({ done: true }),
        },
      ],
    }, { workspaceDir: tempDir })

    expect(result.status).toBe('passed')
    expect(capturedRetriesDuringRetry).toEqual({ 0: 1 })
    expect(readRunState(resolveRunDir(tempDir, result.runId)).activeGuardrailRetries).toBeUndefined()
  })
})

describe('afterStep guardrails matrix reset (AC 5.1.3)', () => {
  it('resets activeGuardrailRetries cleanly across matrix slices', async () => {
    const retriesPerSlice: Record<number, number> = {}
    const rail: Guardrail = {
      __kind: 'guardrail',
      type: 'fn',
      maxRetries: 2,
      execute: async (input) => {
        const sliceIdx = input.ctx.matrix?.index ?? 0
        if (input.attempt === 1) {
          return { status: 'fail', body: `fail slice ${sliceIdx}` }
        }
        retriesPerSlice[sliceIdx] = readRunState(input.runDir).activeGuardrailRetries?.['0'] ?? 0
        return { status: 'pass' }
      },
    }

    const agent = makeTestAgent([
      { code: 'a' },
      { code: 'b' },
      { code: 'c' },
      { code: 'd' },
    ])
    const result = await runHarness({
      name: 'matrix-guardrail-test',
      steps: [
        {
          id: 'matrix-step',
          matrix: {
            items: ['item1', 'item2'],
          },
          run: agent,
          afterStep: [rail],
        },
      ],
    }, { workspaceDir: tempDir })

    expect(result.status).toBe('passed')
    expect(retriesPerSlice[0]).toBe(1)
    expect(retriesPerSlice[1]).toBe(1)
  })
})

describe('afterStep guardrail factories', () => {
  it('evaluates an afterStep factory with the completed step context', async () => {
    let capturedOutput: unknown
    const rail: Guardrail = {
      __kind: 'guardrail',
      type: 'fn',
      execute: async () => ({ status: 'pass' }),
    }
    const result = await runHarness({
      name: 'context-aware-after-step-test',
      steps: [
        {
          id: 'step-with-factory',
          run: async () => ({ guess: 7 }),
          outputSchema: z.object({
            guess: z.number(),
          }),
          afterStep: (ctx: any) => {
            capturedOutput = ctx.step.output
            return [rail]
          },
        },
      ],
    }, { workspaceDir: tempDir })

    expect(result.status).toBe('passed')
    expect(capturedOutput).toEqual({ guess: 7 })
  })
})

describe('afterStep guardrails context output (AC 5.1.4)', () => {
  it('exposes validated step output and sessionId inside afterStep ctx', async () => {
    let capturedOutputInGuardrail: any
    let capturedSessionInGuardrail: any
    const rail: Guardrail = {
      __kind: 'guardrail',
      type: 'fn',
      execute: async (input) => {
        capturedOutputInGuardrail = input.ctx.step.output
        capturedSessionInGuardrail = (input.ctx.step.output as any)?.sessionId
        return { status: 'pass' }
      },
    }

    const agent = makeTestAgent([
      { code: 'clean code' },
    ])
    const result = await runHarness({
      name: 'context-output-test',
      steps: [
        {
          id: 'step-with-schema',
          run: agent,
          outputSchema: z.object({
            code: z.string(),
          }),
          afterStep: [rail],
        },
      ],
    }, { workspaceDir: tempDir })

    expect(result.status).toBe('passed')
    expect(capturedOutputInGuardrail).toEqual(expect.objectContaining({
      code: 'clean code',
      sessionId: expect.stringMatching(/^session-/),
    }))
    expect(typeof capturedSessionInGuardrail).toBe('string')
  })
})

describe('afterStep guardrails failure and circuit breakers', () => {
  it('fails deterministic TS callback steps immediately without retrying', async () => {
    const rail: Guardrail = {
      __kind: 'guardrail',
      type: 'fn',
      maxRetries: 5,
      execute: async () => ({ status: 'fail', body: 'fatal failure' }),
    }

    const result = await runHarness({
      name: 'ts-step-fail-test',
      steps: [
        {
          id: 'ts-step',
          run: async () => ({ hello: 'world' }),
          afterStep: [rail],
        },
      ],
    }, { workspaceDir: tempDir })

    expect(result.status).toBe('failed')
    expect(result.error).toBeInstanceOf(GuardrailMaxRetriesExceededError)
  })

  it('enforces step-level maxTotalTurns circuit breaker during guardrail retries', async () => {
    const alwaysFailRail: Guardrail = {
      __kind: 'guardrail',
      type: 'fn',
      maxRetries: 10,
      execute: async () => ({ status: 'fail', body: 'never passes' }),
    }

    const agent = makeTestAgent([
      { code: 'a' },
    ])
    const result = await runHarness({
      name: 'max-total-turns-guardrail-test',
      steps: [
        {
          id: 'circuit-breaker-step',
          maxTotalTurns: 3,
          run: agent,
          afterStep: [alwaysFailRail],
        },
      ],
    }, { workspaceDir: tempDir })

    expect(result.status).toBe('failed')
    expect(result.error).toBeInstanceOf(MaxTotalTurnsExceededError)
  })
})
