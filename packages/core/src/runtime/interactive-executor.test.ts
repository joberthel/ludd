import type { StepContext } from '../types/context.js'
import type { StepConfig } from '../types/harness.js'
import type { RunStateSnapshot } from '../types/state.js'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readLedgerEvents } from '../persistence/ledger-writer.js'
import { readRunState } from '../persistence/state-store.js'
import { executeAgentStep } from './agent-executor.js'
import { createGateWaiter } from './gate-waiter.js'
import {
  askInteractiveQuestion,
  createInteractiveQuestionHandler,
  resolveInteractiveOptions,
  runInitialInteractiveQuestions,
  validateInteractiveAnswer,
} from './interactive-executor.js'

const dirs: string[] = []
function makeRunDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ludd-interactive-'))
  dirs.push(dir)
  return dir
}

function makeSnapshot(): RunStateSnapshot {
  return {
    schemaVersion: 1,
    runId: 'run-1',
    harnessName: 'test',
    workflowName: 'test',
    status: 'running',
    activeStepId: 'step-1',
    steps: {},
    updatedAt: new Date().toISOString(),
  }
}

function makeContext(): StepContext {
  return {
    runId: 'run-1',
    environments: {},
    steps: {},
    step: { id: 'step-1', output: undefined, attempt: 1 },
    matrix: undefined,
    artifacts: {} as never,
  }
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('validateInteractiveAnswer', () => {
  it('validates text, number, confirm, select, and multi-select answers', () => {
    expect(validateInteractiveAnswer({ type: 'text', prompt: 'Q' }, 'hello')).toBe('hello')
    expect(() => validateInteractiveAnswer({ type: 'text', prompt: 'Q' }, 42)).toThrow('text')

    expect(validateInteractiveAnswer({
      type: 'number',
      prompt: 'Q',
      min: 1,
      max: 10,
    }, '5')).toBe(5)
    expect(validateInteractiveAnswer({ type: 'number', prompt: 'Q' }, 3)).toBe(3)
    expect(() => validateInteractiveAnswer({ type: 'number', prompt: 'Q' }, '')).toThrow('valid number')
    expect(() => validateInteractiveAnswer({ type: 'number', prompt: 'Q' }, true)).toThrow('valid number')
    expect(() => validateInteractiveAnswer({ type: 'number', prompt: 'Q', min: 5 }, 2)).toThrow('at least 5')
    expect(() => validateInteractiveAnswer({ type: 'number', prompt: 'Q', max: 5 }, 9)).toThrow('at most 5')

    expect(validateInteractiveAnswer({ type: 'confirm', prompt: 'Q' }, true)).toBe(true)
    expect(() => validateInteractiveAnswer({ type: 'confirm', prompt: 'Q' }, 'yes')).toThrow('boolean')

    const sel = {
      type: 'select' as const,
      prompt: 'Q',
      options: [
        'a',
        { label: 'B', value: 'b' },
      ],
    }
    expect(validateInteractiveAnswer(sel, 'b')).toBe('b')
    expect(() => validateInteractiveAnswer(sel, 'z')).toThrow('Expected one of')

    const multi = {
      type: 'multi-select' as const,
      prompt: 'Q',
      options: ['a', 'b'],
    }
    expect(validateInteractiveAnswer(multi, ['a', 'b'])).toEqual(['a', 'b'])
    expect(() => validateInteractiveAnswer(multi, 'a')).toThrow('array')
    expect(() => validateInteractiveAnswer(multi, ['z'])).toThrow('array')
  })
})

describe('interactive runtime execution', () => {
  it('resolves boolean and object interactive options', () => {
    expect(resolveInteractiveOptions(undefined)).toBeUndefined()
    expect(resolveInteractiveOptions(false)).toBeUndefined()
    expect(resolveInteractiveOptions(true)).toEqual({})
    expect(resolveInteractiveOptions({ maxQuestions: 3 })).toEqual({ maxQuestions: 3 })
  })

  it('asks initial questions, persists answers incrementally, and skips already-answered keys on resume', async () => {
    const runDir = makeRunDir()
    const snapshot = makeSnapshot()
    snapshot.activeInteractiveAnswers = { first: 'already-done' }
    const ctx = makeContext()
    ctx.matrix = { index: 0, total: 1, item: 'x' }
    const gateWaiter = createGateWaiter()
    const step: StepConfig = {
      id: 'step-1',
      interactive: {
        initialQuestions: () => ({
          first: { type: 'text', prompt: 'First?' },
          max: {
            type: 'number',
            prompt: 'Max?',
            min: 1,
            max: 10,
          },
        }),
      },
      run: () => 'ok',
    }

    const promise = runInitialInteractiveQuestions({
      step,
      ctx,
      snapshot,
      runDir,
      gateWaiter,
    })
    await new Promise(resolve => setTimeout(resolve, 10))
    const persisted = readRunState(runDir)
    expect(persisted.activeGate?.gateType).toBe('user_question')
    expect(persisted.activeGate?.questionKey).toBe('max')
    gateWaiter.resolve({
      stepId: 'step-1',
      guardrailIndex: 1,
      action: 'answer',
      answer: 7,
    })
    await promise

    expect((ctx as StepContext & { interactive: Record<string, unknown> }).interactive).toEqual({
      first: 'already-done',
      max: 7,
    })
    expect(snapshot.activeInteractiveAnswers).toEqual({ first: 'already-done', max: 7 })
    expect(readLedgerEvents(runDir).some(e => e.eventType === 'gate.waiting')).toBe(true)
  })

  it('handles static initialQuestions, missing gateWaiter, and abort resolution', async () => {
    const runDir = makeRunDir()
    const snapshot = makeSnapshot()
    const ctx = makeContext()
    const plainStep: StepConfig = {
      id: 'step-1',
      interactive: true,
      run: () => 'ok',
    }
    await runInitialInteractiveQuestions({
      step: plainStep,
      ctx,
      snapshot,
      runDir,
    })

    const stepWithQ: StepConfig = {
      id: 'step-1',
      interactive: {
        initialQuestions: {
          q: { type: 'text', prompt: 'Q?' },
        },
      },
      run: () => 'ok',
    }
    await expect(runInitialInteractiveQuestions({
      step: stepWithQ,
      ctx,
      snapshot,
      runDir,
    }))
      .rejects
      .toThrow('without an active gate waiter')

    const gateWaiter = createGateWaiter()
    const p = askInteractiveQuestion({
      runDir,
      snapshot,
      stepId: 'step-1',
      phase: 'run',
      questionIndex: 0,
      question: { type: 'text', prompt: 'Q?' },
      gateWaiter,
    })
    gateWaiter.resolve({ stepId: 'step-1', guardrailIndex: 0, action: 'abort' })
    await expect(p).rejects.toThrow('aborted by user')
  })

  it('enforces maxQuestions and requires gateWaiter in createInteractiveQuestionHandler', async () => {
    const runDir = makeRunDir()
    const snapshot = makeSnapshot()
    expect(createInteractiveQuestionHandler({
      step: {
        id: 's',
        run: () => 'ok',
      },
      snapshot,
      runDir,
    })).toBeUndefined()

    const noWaiterHandler = createInteractiveQuestionHandler({
      step: {
        id: 's',
        interactive: true,
        run: () => 'ok',
      },
      snapshot,
      runDir,
    })!
    await expect(noWaiterHandler({ type: 'text', prompt: 'Q?' })).rejects.toThrow('without an active gate waiter')

    const gateWaiter = createGateWaiter()
    const handler = createInteractiveQuestionHandler({
      step: {
        id: 's',
        interactive: { maxQuestions: 1 },
        run: () => 'ok',
      },
      snapshot,
      runDir,
      gateWaiter,
    })!
    const p = handler({ type: 'text', prompt: 'First?' })
    gateWaiter.resolve({
      stepId: 's',
      guardrailIndex: 0,
      action: 'answer',
      answer: 'yes',
    })
    expect(await p).toBe('yes')
    await expect(handler({ type: 'text', prompt: 'Second?' })).rejects.toThrow('Question budget exhausted (1)')
  })

  it('passes interactive: true to agent executeTurn and registers/clears askUserHandler', async () => {
    const runDir = makeRunDir()
    const snapshot = makeSnapshot()
    const ctx = makeContext()
    let seenInteractive: boolean | undefined
    const registered: unknown[] = []
    const mcpServer = {
      url: 'http://127.0.0.1:0/mcp',
      authToken: 'tok',
      setAskUserHandler: (h: unknown) => {
        registered.push(h)
      },
    }
    const step: StepConfig = {
      id: 'step-1',
      interactive: true,
      run: {
        __kind: 'agent',
        mode: 'read-only',
        prompt: 'hello',
        executeTurn: async (input) => {
          seenInteractive = input.interactive
          return { output: 'done', sessionId: input.sessionId }
        },
      },
    }
    await executeAgentStep(step, step.run as never, ctx, snapshot, runDir, undefined, mcpServer)
    expect(seenInteractive).toBe(true)
    expect(typeof registered[0]).toBe('function')
    expect(registered[1]).toBeUndefined()
  })

  it('serializes concurrent ask_user calls in FIFO order without overwriting activeGate', async () => {
    const runDir = makeRunDir()
    const snapshot = makeSnapshot()
    const gateWaiter = createGateWaiter()
    const handler = createInteractiveQuestionHandler({
      step: {
        id: 'plan',
        interactive: true,
        run: () => 'ok',
      },
      snapshot,
      runDir,
      gateWaiter,
    })!

    const first = handler({
      type: 'select',
      prompt: 'First question?',
      options: ['a', 'b'],
    })
    const second = handler({
      type: 'select',
      prompt: 'Second question?',
      options: ['x', 'y'],
    })

    await new Promise(resolve => setTimeout(resolve, 10))
    const firstPersisted = readRunState(runDir)
    expect(firstPersisted.activeGate?.prompt).toBe('First question?')
    expect(firstPersisted.activeGate?.guardrailIndex).toBe(0)
    expect(readLedgerEvents(runDir).filter(e => e.eventType === 'gate.waiting')).toHaveLength(1)

    gateWaiter.resolve({
      stepId: 'plan',
      guardrailIndex: 0,
      action: 'answer',
      answer: 'b',
    })
    expect(await first).toBe('b')

    await new Promise(resolve => setTimeout(resolve, 10))
    const secondPersisted = readRunState(runDir)
    expect(secondPersisted.activeGate?.prompt).toBe('Second question?')
    expect(secondPersisted.activeGate?.guardrailIndex).toBe(1)
    expect(readLedgerEvents(runDir).filter(e => e.eventType === 'gate.waiting')).toHaveLength(2)

    gateWaiter.resolve({
      stepId: 'plan',
      guardrailIndex: 1,
      action: 'answer',
      answer: 'x',
    })
    expect(await second).toBe('x')
  })

  it('recovers the ask_user queue after a rejected question and preserves maxQuestions budget', async () => {
    const runDir = makeRunDir()
    const snapshot = makeSnapshot()
    const gateWaiter = createGateWaiter()
    const handler = createInteractiveQuestionHandler({
      step: {
        id: 'plan',
        interactive: { maxQuestions: 2 },
        run: () => 'ok',
      },
      snapshot,
      runDir,
      gateWaiter,
    })!

    const first = handler({ type: 'text', prompt: 'Q1?' })
    const second = handler({ type: 'text', prompt: 'Q2?' })
    const third = handler({ type: 'text', prompt: 'Q3?' })

    await new Promise(resolve => setTimeout(resolve, 10))
    gateWaiter.resolve({ stepId: 'plan', guardrailIndex: 0, action: 'abort' })
    await expect(first).rejects.toThrow('aborted by user')

    await new Promise(resolve => setTimeout(resolve, 10))
    expect(readRunState(runDir).activeGate?.prompt).toBe('Q2?')
    gateWaiter.resolve({
      stepId: 'plan',
      guardrailIndex: 1,
      action: 'answer',
      answer: 'second-answer',
    })
    expect(await second).toBe('second-answer')
    await expect(third).rejects.toThrow('Question budget exhausted (2)')
  })

  it('rejects askInteractiveQuestion without mutating state when a gate is already waiting or aborted', async () => {
    const runDir = makeRunDir()
    const snapshot = makeSnapshot()
    const gateWaiter = createGateWaiter()
    const first = askInteractiveQuestion({
      runDir,
      snapshot,
      stepId: 'step-1',
      phase: 'run',
      questionIndex: 0,
      question: { type: 'text', prompt: 'Active?' },
      gateWaiter,
    })

    await expect(askInteractiveQuestion({
      runDir,
      snapshot,
      stepId: 'step-1',
      phase: 'run',
      questionIndex: 1,
      question: { type: 'text', prompt: 'Collision?' },
      gateWaiter,
    })).rejects.toThrow('A gate is already waiting for resolution: step-1 (index 0)')
    expect(readRunState(runDir).activeGate?.prompt).toBe('Active?')
    expect(readLedgerEvents(runDir).filter(e => e.eventType === 'gate.waiting')).toHaveLength(1)

    gateWaiter.resolve({
      stepId: 'step-1',
      guardrailIndex: 0,
      action: 'answer',
      answer: 'ok',
    })
    expect(await first).toBe('ok')

    const controller = new AbortController()
    controller.abort('run cancelled')
    const abortedWaiter = createGateWaiter(controller.signal)
    const abortedSnapshot = makeSnapshot()
    await expect(askInteractiveQuestion({
      runDir,
      snapshot: abortedSnapshot,
      stepId: 'step-1',
      phase: 'run',
      questionIndex: 2,
      question: { type: 'text', prompt: 'After abort?' },
      gateWaiter: abortedWaiter,
    })).rejects.toThrow('run cancelled')
    expect(abortedSnapshot.activeGate).toBeUndefined()
  })
})
