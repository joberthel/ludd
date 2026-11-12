import type { ControlClient, RunStateSnapshot } from '@ludd/core'
import { createInterface } from 'node:readline/promises'
import { afterEach, expect, it, vi } from 'vitest'
import { promptForGate } from './inline-gate-prompter.js'

const { question, close } = vi.hoisted(() => ({
  question: vi.fn<(...args: string[]) => Promise<string>>(),
  close: vi.fn(),
}))

vi.mock('node:readline/promises', () => ({
  createInterface: vi.fn(() => ({ question, close })),
}))

function snapshot(gateType: 'human_review' | 'max_retries_exceeded' = 'human_review'): RunStateSnapshot {
  return {
    schemaVersion: 1,
    runId: 'run-a',
    harnessName: 'workflow',
    workflowName: 'workflow',
    status: 'waiting_for_gate',
    activeStepId: 'step-a',
    activeGate: {
      stepId: 'step-a',
      phase: 'afterStep',
      guardrailIndex: 1,
      gateType,
      prompt: 'Approve?',
      createdAt: new Date().toISOString(),
    },
    steps: {},
    updatedAt: new Date().toISOString(),
  }
}

function client(): ControlClient {
  return {
    resolveGate: vi.fn(async () => ({ ok: true })),
  } as unknown as ControlClient
}

afterEach(() => {
  question.mockReset()
  close.mockClear()
  vi.mocked(createInterface).mockClear()
  vi.restoreAllMocks()
})

it('returns immediately if there is no active gate', async () => {
  const current = snapshot()
  current.activeGate = null
  await promptForGate(current, client())
  expect(createInterface).not.toHaveBeenCalled()
})

it('resolves a human review pass with feedback', async () => {
  const control = client()
  question.mockResolvedValueOnce('').mockResolvedValueOnce('Looks good')
  await promptForGate(snapshot(), control)
  expect(control.resolveGate).toHaveBeenCalledWith({
    stepId: 'step-a',
    guardrailIndex: 1,
    action: 'pass',
    feedback: 'Looks good',
  })
  expect(close).toHaveBeenCalledOnce()
})

it('omits empty human review feedback', async () => {
  const control = client()
  question.mockResolvedValueOnce('p').mockResolvedValueOnce('')
  await promptForGate(snapshot(), control)
  expect(control.resolveGate).toHaveBeenCalledWith({
    stepId: 'step-a',
    guardrailIndex: 1,
    action: 'pass',
  })
})

it.each(['f', 'fail'])('requires feedback for human review failure (%s)', async (action) => {
  const control = client()
  question.mockResolvedValueOnce(action).mockResolvedValueOnce('  ')
  await expect(promptForGate(snapshot(), control)).rejects.toThrow('Feedback is required when failing a human review gate.')
  expect(control.resolveGate).not.toHaveBeenCalled()
  expect(close).toHaveBeenCalledOnce()
})

it('resolves a human review failure with feedback', async () => {
  const control = client()
  question.mockResolvedValueOnce('f').mockResolvedValueOnce('Please fix')
  await promptForGate(snapshot(), control)
  expect(control.resolveGate).toHaveBeenCalledWith({
    stepId: 'step-a',
    guardrailIndex: 1,
    action: 'fail',
    feedback: 'Please fix',
  })
})

it.each(['a', 'abort'])('resolves a human review abort action (%s)', async (action) => {
  const control = client()
  question.mockResolvedValueOnce(action).mockResolvedValueOnce('Stop')
  await promptForGate(snapshot(), control)
  expect(control.resolveGate).toHaveBeenCalledWith({
    stepId: 'step-a',
    guardrailIndex: 1,
    action: 'abort',
    feedback: 'Stop',
  })
})

it('resolves max-retry retry with default retry count and feedback', async () => {
  const control = client()
  question.mockResolvedValueOnce('').mockResolvedValueOnce('').mockResolvedValueOnce('try again')
  await promptForGate(snapshot('max_retries_exceeded'), control)
  expect(control.resolveGate).toHaveBeenCalledWith({
    stepId: 'step-a',
    guardrailIndex: 1,
    action: 'retry',
    addRetries: 1,
    feedback: 'try again',
  })
})

it('resolves max-retry pass without retry count or feedback', async () => {
  const control = client()
  question.mockResolvedValueOnce('p').mockResolvedValueOnce('')
  await promptForGate(snapshot('max_retries_exceeded'), control)
  expect(control.resolveGate).toHaveBeenCalledWith({
    stepId: 'step-a',
    guardrailIndex: 1,
    action: 'pass',
  })
})

it('resolves max-retry skip', async () => {
  const control = client()
  question.mockResolvedValueOnce('s').mockResolvedValueOnce('Skip this')
  await promptForGate(snapshot('max_retries_exceeded'), control)
  expect(control.resolveGate).toHaveBeenCalledWith({
    stepId: 'step-a',
    guardrailIndex: 1,
    action: 'skip',
    feedback: 'Skip this',
  })
})

it('resolves max-retry abort', async () => {
  const control = client()
  question.mockResolvedValueOnce('a').mockResolvedValueOnce('Stop')
  await promptForGate(snapshot('max_retries_exceeded'), control)
  expect(control.resolveGate).toHaveBeenCalledWith({
    stepId: 'step-a',
    guardrailIndex: 1,
    action: 'abort',
    feedback: 'Stop',
  })
})
