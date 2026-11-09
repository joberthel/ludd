import type { AgentRunner, AgentTurnInput } from '../../types/agent.js'
import type { Guardrail } from '../../types/guardrail.js'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readLedgerEvents } from '../../persistence/ledger-writer.js'
import { readRunState, resolveRunDir } from '../../persistence/state-store.js'
import { runHarness } from '../run-harness.js'

let tempDir: string

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-before-life-'))
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

function makePassFailRails(): [Guardrail, Guardrail] {
  const passRail: Guardrail = {
    __kind: 'guardrail',
    type: 'fn',
    execute: async () => ({ status: 'pass', body: 'Linter passed cleanly' }),
  }
  const failRail: Guardrail = {
    __kind: 'guardrail',
    type: 'exec',
    execute: async () => ({
      status: 'fail',
      rawLog: 'WARN: 3 warnings detected',
      body: 'Warning summary',
    }),
  }
  return [passRail, failRail]
}

describe('beforeStep non-halting context collection (AC 5.3.4)', () => {
  it('collects beforeStep logs without halting on fail verdicts and injects context', async () => {
    let turn1Prompt = ''
    const [passRail, failRail] = makePassFailRails()

    const agent: AgentRunner<{ ok: boolean }> = {
      __kind: 'agent',
      mode: 'workspace-write',
      prompt: 'Base task instruction',
      executeTurn: async (input: AgentTurnInput) => {
        turn1Prompt = input.prompt
        return {
          output: { ok: true },
          sessionId: input.sessionId,
        }
      },
    }

    const result = await runHarness({
      name: 'before-step-test',
      steps: [
        {
          id: 'bstep',
          beforeStep: [passRail, failRail],
          run: agent,
        },
      ],
    }, { workspaceDir: tempDir })

    expect(result.status).toBe('passed')
    expect(turn1Prompt).toContain('Context from beforeStep guardrails is available via MCP tools:')
    expect(turn1Prompt).toContain('Guardrail #0: logKey="bstep-1-beforeStep-0" (status: pass)')
    expect(turn1Prompt).toContain('Guardrail #1: logKey="bstep-1-beforeStep-1" (status: fail)')
    expect(turn1Prompt).toContain('Base task instruction')

    const runDir = resolveRunDir(tempDir, result.runId)
    const snap = readRunState(runDir)
    expect(snap.logs?.['bstep-1-beforeStep-0']).toBeDefined()
    expect(snap.logs?.['bstep-1-beforeStep-1']).toBeDefined()

    const events = readLedgerEvents(runDir).filter(e => e.payload?.phase === 'beforeStep')
    expect(events.map(e => e.eventType)).toEqual([
      'guardrail.started',
      'guardrail.passed',
      'guardrail.started',
      'guardrail.failed',
    ])
  })
})

describe('beforeStep unhandled error abort (AC 5.3.4)', () => {
  it('aborts harness immediately when beforeStep throws an unhandled Error', async () => {
    let agentTurnRan = false
    const throwingRail: Guardrail = {
      __kind: 'guardrail',
      type: 'fn',
      execute: async () => {
        throw new Error('Fatal error in beforeStep setup')
      },
    }

    const result = await runHarness({
      name: 'before-step-throw-test',
      steps: [
        {
          id: 'throw-step',
          beforeStep: [throwingRail],
          run: {
            __kind: 'agent',
            mode: 'workspace-write',
            prompt: 'Prompt',
            executeTurn: async (input) => {
              agentTurnRan = true
              return { output: 'never', sessionId: input.sessionId }
            },
          },
        },
      ],
    }, { workspaceDir: tempDir })

    expect(result.status).toBe('failed')
    expect(agentTurnRan).toBe(false)
  })
})

describe('state.json artifacts indexing and matrix beforeStep execution', () => {
  it('indexes artifacts into state.json and executes beforeStep across matrix slices', async () => {
    let beforeStepCallCount = 0
    const countRail: Guardrail = {
      __kind: 'guardrail',
      type: 'fn',
      execute: async () => {
        beforeStepCallCount += 1
        return { status: 'pass', body: `Setup check ${beforeStepCallCount}` }
      },
    }

    const result = await runHarness({
      name: 'artifacts-and-matrix-test',
      steps: [
        {
          id: 'step-produce-artifact',
          run: async (ctx) => {
            await ctx.artifacts.put('output/result.json', '{"status":"ok"}')
            await ctx.artifacts.put('output/result.json', '{"status":"ok2"}')
            return { produced: true }
          },
        },
        {
          id: 'matrix-step',
          matrix: {
            items: ['itemA', 'itemB'],
          },
          beforeStep: [countRail],
          run: async ctx => ({ item: ctx.matrix?.item }),
        },
      ],
    }, { workspaceDir: tempDir })

    expect(result.status).toBe('passed')
    expect(beforeStepCallCount).toBe(2)

    const snap = readRunState(resolveRunDir(tempDir, result.runId))
    expect(snap.artifacts).toContain('output/result.json')
  })
})
