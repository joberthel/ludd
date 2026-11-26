import type { AgentRunner, AgentTurnInput } from '../../types/agent.js'
import type { ArtifactClient, StepContext } from '../../types/context.js'
import type { StepConfig } from '../../types/harness.js'
import type { RunStateSnapshot } from '../../types/state.js'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { StepOutputValidationError } from '../../errors/step-output-validation-error.js'
import { executeAgentStep } from '../agent-executor.js'

function createDummyContext(): StepContext {
  return {
    runId: 'r-exec-test',
    steps: {},
    step: { id: 'test-step', output: undefined, attempt: 1 },
    matrix: undefined,
    artifacts: {} as ArtifactClient,
  }
}

function createDummySnapshot(stepId = 'test-step'): RunStateSnapshot {
  return {
    schemaVersion: 1,
    runId: 'r-exec-test',
    harnessName: 'test-harness',
    workflowName: 'test-harness',
    status: 'running',
    activeStepId: stepId,
    activeSessionId: null,
    activeStepAttempt: 1,
    steps: {},
    updatedAt: new Date().toISOString(),
  }
}

describe('executeAgentStep dynamic prompt and default session resolution', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-agent-exec-test-'))
  })
  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('resolves dynamic prompt, generates default sessionId, and merges output', async () => {
    let captured: AgentTurnInput | undefined
    const agent: AgentRunner<string> = {
      __kind: 'agent',
      mode: 'read-only',
      prompt: ctx => `Prompt for ${ctx.runId}`,
      executeTurn: async (input) => {
        captured = input
        return { output: 'done', sessionId: input.sessionId }
      },
    }
    const step: StepConfig = { id: 's-1', run: agent }
    const ctx = createDummyContext()

    const output = await executeAgentStep(step, agent, ctx, createDummySnapshot('s-1'), tempDir)

    expect(captured?.stepId).toBe('s-1')
    expect(captured?.prompt).toBe('Prompt for r-exec-test')
    expect(captured?.sessionId).toMatch(/^session-[0-9a-f-]+$/)
    expect(captured).not.toHaveProperty('previousSessionId')
    expect(captured?.mode).toBe('read-only')
    expect(captured?.attempt).toBe(1)
    expect(captured?.runDir).toBe(tempDir)
    expect(captured?.mcp).toBeUndefined()
    expect(output).toEqual({ value: 'done', sessionId: captured?.sessionId })
  })

  it('tracks agent-returned sessionId across retries and forwards previousSessionId', async () => {
    const seen: AgentTurnInput[] = []
    const schema = z.object({
      ok: z.literal(true),
    })
    const agent: AgentRunner<{ ok: boolean }> = {
      __kind: 'agent',
      mode: 'read-only',
      prompt: 'produce ok',
      executeTurn: async (input) => {
        seen.push(input)
        if (input.attempt === 1) {
          return {
            output: { ok: false },
            sessionId: 'agent-session-1',
          }
        }
        return {
          output: { ok: true },
          sessionId: input.previousSessionId ?? input.sessionId,
        }
      },
    }
    const snapshot = createDummySnapshot('s-retry-sess')
    const output = await executeAgentStep(
      { id: 's-retry-sess', run: agent, outputSchema: schema },
      agent,
      createDummyContext(),
      snapshot,
      tempDir,
    )

    expect(seen[0]).not.toHaveProperty('previousSessionId')
    expect(seen[1]?.sessionId).toBe('agent-session-1')
    expect(seen[1]?.previousSessionId).toBe('agent-session-1')
    expect(snapshot.activeSessionId).toBe('agent-session-1')
    expect(output).toEqual({ ok: true, sessionId: 'agent-session-1' })
  })
})

describe('executeAgentStep outputSchema forwarding', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-agent-exec-schema-'))
  })
  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('forwards the step outputSchema to the agent turn only when declared', async () => {
    const seen: AgentTurnInput[] = []
    const agent: AgentRunner<unknown> = {
      __kind: 'agent',
      mode: 'read-only',
      prompt: 'p',
      executeTurn: async (input) => {
        seen.push(input)
        return {
          output: { ok: true },
          sessionId: input.sessionId,
        }
      },
    }
    const schema = z.object({
      ok: z.boolean(),
    })
    await executeAgentStep({ id: 's-1', run: agent, outputSchema: schema }, agent, createDummyContext(), createDummySnapshot('s-1'), tempDir)
    await executeAgentStep({ id: 's-1', run: agent }, agent, createDummyContext(), createDummySnapshot('s-1'), tempDir)
    expect(seen[0]?.outputSchema).toBe(schema)
    expect(seen[1]).not.toHaveProperty('outputSchema')
  })
})

describe('executeAgentStep dynamic sessionId and fallback handling', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-agent-exec-sess-'))
  })
  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('resolves dynamic sessionId and handles undefined resolution fallback', async () => {
    let capturedSessId: string | undefined
    const customAgent: AgentRunner<string> = {
      __kind: 'agent',
      mode: 'workspace-write',
      prompt: 'static prompt',
      sessionId: ctx => `sess-${ctx.runId}`,
      executeTurn: async (input) => {
        capturedSessId = input.sessionId
        return { output: 'ok', sessionId: input.sessionId }
      },
    }
    const step: StepConfig = { id: 's-2', run: customAgent }
    const ctx = createDummyContext()

    await executeAgentStep(step, customAgent, ctx, createDummySnapshot('s-2'), tempDir)
    expect(capturedSessId).toBe('sess-r-exec-test')

    const fallbackAgent: AgentRunner<string> = {
      __kind: 'agent',
      mode: 'workspace-write',
      prompt: 'static prompt',
      sessionId: () => undefined,
      executeTurn: async (input) => {
        capturedSessId = input.sessionId
        return { output: 'fallback', sessionId: input.sessionId }
      },
    }
    await executeAgentStep({ id: 's-3', run: fallbackAgent }, fallbackAgent, ctx, createDummySnapshot('s-3'), tempDir)
    expect(capturedSessId).toMatch(/^session-[0-9a-f-]+$/)
  })
})

describe('executeAgentStep outputSchema handling and transformation', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-agent-exec-schema-'))
  })
  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('validates and transforms output according to step outputSchema', async () => {
    const agent: AgentRunner<{ count: number }> = {
      __kind: 'agent',
      mode: 'read-only',
      prompt: 'compute count',
      executeTurn: async input => ({
        output: { count: 42 },
        sessionId: input.sessionId,
      }),
    }
    const schema = z.object({
      count: z.number().transform(n => n * 2),
    })
    const step: StepConfig = { id: 's-schema', run: agent, outputSchema: schema }
    const ctx = createDummyContext()

    const output = (await executeAgentStep(step, agent, ctx, createDummySnapshot('s-schema'), tempDir)) as {
      count: number
      sessionId: string
    }
    expect(output.count).toBe(84)
    expect(output.sessionId).toMatch(/^session-[0-9a-f-]+$/)
  })

  it('forwards explicit cwd, env, and signal to agent turns without environment handle', async () => {
    let captured: AgentTurnInput | undefined
    const controller = new AbortController()
    const agent: AgentRunner<string> = {
      __kind: 'agent',
      mode: 'workspace-write',
      prompt: 'run in worktree',
      executeTurn: async (input) => {
        captured = input
        return { output: 'ok', sessionId: input.sessionId }
      },
    }
    const step: StepConfig = { id: 's-host', run: agent }
    await executeAgentStep(
      step,
      agent,
      createDummyContext(),
      createDummySnapshot('s-host'),
      tempDir,
      undefined,
      { url: 'http://127.0.0.1:9999/mcp', authToken: 'tok' },
      {
        cwd: '/repo/wt',
        env: { WT: '1' },
        signal: controller.signal,
      },
    )

    expect(captured?.cwd).toBe('/repo/wt')
    expect(captured?.env).toEqual({ WT: '1' })
    expect(captured?.signal).toBe(controller.signal)
    expect(captured?.mcp).toEqual({
      url: 'http://127.0.0.1:9999/mcp',
      authToken: 'tok',
    })
    expect(captured).not.toHaveProperty('environment')
  })

  it('aborts immediately on pre-aborted or mid-turn aborted signal and never retries aborted guardrails', async () => {
    const preCtrl = new AbortController()
    preCtrl.abort(new Error('pre-aborted-agent'))
    const neverCalled = vi.fn()
    await expect(
      executeAgentStep(
        {
          id: 's-pre',
          run: {
            __kind: 'agent',
            mode: 'read-only',
            prompt: 'p',
            executeTurn: neverCalled,
          },
        },
        {
          __kind: 'agent',
          mode: 'read-only',
          prompt: 'p',
          executeTurn: neverCalled,
        },
        createDummyContext(),
        createDummySnapshot('s-pre'),
        tempDir,
        undefined,
        undefined,
        { cwd: tempDir, env: {}, signal: preCtrl.signal },
      ),
    ).rejects.toThrow('pre-aborted-agent')
    expect(neverCalled).not.toHaveBeenCalled()

    const midTurnCtrl = new AbortController()
    const midTurnAgent: AgentRunner<string> = {
      __kind: 'agent',
      mode: 'read-only',
      prompt: 'p',
      executeTurn: async (input) => {
        midTurnCtrl.abort(new Error('aborted-in-turn'))
        return { output: 'partial', sessionId: input.sessionId }
      },
    }
    await expect(
      executeAgentStep(
        { id: 's-mid-turn', run: midTurnAgent },
        midTurnAgent,
        createDummyContext(),
        createDummySnapshot('s-mid-turn'),
        tempDir,
        undefined,
        undefined,
        { cwd: tempDir, env: {}, signal: midTurnCtrl.signal },
      ),
    ).rejects.toThrow('aborted-in-turn')

    const railCtrl = new AbortController()
    let attempts = 0
    const retryProtectedAgent: AgentRunner<string> = {
      __kind: 'agent',
      mode: 'read-only',
      prompt: 'p',
      executeTurn: async (input) => {
        attempts += 1
        return { output: 'done', sessionId: input.sessionId }
      },
    }
    const abortingRailStep: StepConfig = {
      id: 's-abort-rail',
      run: retryProtectedAgent,
      afterStep: [
        {
          __kind: 'guardrail',
          type: 'agent',
          execute: async () => {
            railCtrl.abort(new Error('aborted-in-guardrail'))
            throw new StepOutputValidationError('s-abort-rail', undefined, [
              {
                code: 'custom',
                path: ['status'],
                message: 'missing submission',
              },
            ])
          },
        },
      ],
    }

    await expect(
      executeAgentStep(
        abortingRailStep,
        retryProtectedAgent,
        createDummyContext(),
        createDummySnapshot('s-abort-rail'),
        tempDir,
        undefined,
        undefined,
        { cwd: tempDir, env: {}, signal: railCtrl.signal },
      ),
    ).rejects.toThrow('aborted-in-guardrail')
    expect(attempts).toBe(1)
  })
})
