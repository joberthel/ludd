import type { ControlClient, RunStateSnapshot } from '@ludd/core'
import { createInterface } from 'node:readline/promises'
import { afterEach, expect, it, vi } from 'vitest'
import { promptForGate } from './inline-gate-prompter.js'

const { question, close, promptTty } = vi.hoisted(() => ({
  question: vi.fn<(...args: string[]) => Promise<string>>(),
  close: vi.fn(),
  promptTty: vi.fn(async () => 'tty-answer'),
}))

vi.mock('node:readline/promises', () => ({
  createInterface: vi.fn(() => ({ question, close })),
}))
vi.mock('../ui/interactive-question-prompt.js', () => ({
  promptInteractiveQuestionInTty: promptTty,
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

it('resolves a human review pass without asking for feedback', async () => {
  const control = client()
  question.mockResolvedValueOnce('p')
  await promptForGate(snapshot(), control)
  expect(control.resolveGate).toHaveBeenCalledWith({
    stepId: 'step-a',
    guardrailIndex: 1,
    action: 'pass',
  })
  expect(question).toHaveBeenCalledOnce()
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

it.each(['f', 'fail'])('re-prompts for feedback on human review failure (%s) until non-empty', async (action) => {
  const control = client()
  question
    .mockResolvedValueOnce(action)
    .mockResolvedValueOnce('  ')
    .mockResolvedValueOnce('')
    .mockResolvedValueOnce('Please fix')
  await promptForGate(snapshot(), control)
  expect(control.resolveGate).toHaveBeenCalledWith({
    stepId: 'step-a',
    guardrailIndex: 1,
    action: 'fail',
    feedback: 'Please fix',
  })
  expect(question).toHaveBeenCalledTimes(4)
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
  question.mockResolvedValueOnce(action)
  await promptForGate(snapshot(), control)
  expect(control.resolveGate).toHaveBeenCalledWith({
    stepId: 'step-a',
    guardrailIndex: 1,
    action: 'abort',
  })
  expect(question).toHaveBeenCalledOnce()
})

it.each(['s', 'skip'])('resolves a human review skip action (%s)', async (action) => {
  const control = client()
  question.mockResolvedValueOnce(action)
  await promptForGate(snapshot(), control)
  expect(control.resolveGate).toHaveBeenCalledWith({
    stepId: 'step-a',
    guardrailIndex: 1,
    action: 'skip',
  })
  expect(question).toHaveBeenCalledOnce()
})

it('re-prompts on unrecognized human review action until a valid option is entered', async () => {
  const control = client()
  question
    .mockResolvedValueOnce('deny')
    .mockResolvedValueOnce('r')
    .mockResolvedValueOnce('skip')
  await promptForGate(snapshot(), control)
  expect(control.resolveGate).toHaveBeenCalledWith({
    stepId: 'step-a',
    guardrailIndex: 1,
    action: 'skip',
  })
  expect(question).toHaveBeenCalledTimes(3)
  expect(close).toHaveBeenCalledOnce()
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

it('re-prompts on invalid additional retries input until a positive integer is entered', async () => {
  const control = client()
  question
    .mockResolvedValueOnce('r')
    .mockResolvedValueOnce('abc')
    .mockResolvedValueOnce('0')
    .mockResolvedValueOnce('-2')
    .mockResolvedValueOnce('3')
    .mockResolvedValueOnce('try again')
  await promptForGate(snapshot('max_retries_exceeded'), control)
  expect(control.resolveGate).toHaveBeenCalledWith({
    stepId: 'step-a',
    guardrailIndex: 1,
    action: 'retry',
    addRetries: 3,
    feedback: 'try again',
  })
  expect(question).toHaveBeenCalledTimes(6)
  expect(close).toHaveBeenCalledOnce()
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

it('re-prompts on unrecognized max-retry action until a valid option is entered', async () => {
  const control = client()
  question
    .mockResolvedValueOnce('unknown')
    .mockResolvedValueOnce('f')
    .mockResolvedValueOnce('p')
    .mockResolvedValueOnce('')
  await promptForGate(snapshot('max_retries_exceeded'), control)
  expect(control.resolveGate).toHaveBeenCalledWith({
    stepId: 'step-a',
    guardrailIndex: 1,
    action: 'pass',
  })
  expect(question).toHaveBeenCalledTimes(4)
  expect(close).toHaveBeenCalledOnce()
})

it('returns immediately when signal is already aborted', async () => {
  const control = client()
  const controller = new AbortController()
  controller.abort()
  await promptForGate(snapshot(), control, controller.signal)
  expect(createInterface).not.toHaveBeenCalled()
  expect(control.resolveGate).not.toHaveBeenCalled()
})

it('aborts cleanly and closes readline when signal aborts during question', async () => {
  const control = client()
  const controller = new AbortController()
  question.mockImplementationOnce((async (_prompt: string, options?: { signal?: AbortSignal }) => {
    return new Promise((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => {
        const err = new Error('The operation was aborted')
        err.name = 'AbortError'
        reject(err)
      })
    })
  }) as unknown as (...args: string[]) => Promise<string>)

  const pending = promptForGate(snapshot(), control, controller.signal)
  controller.abort()
  await expect(pending).resolves.toBeUndefined()
  expect(control.resolveGate).not.toHaveBeenCalled()
  expect(close).toHaveBeenCalledOnce()
})

it('rethrows non-abort errors from question', async () => {
  const control = client()
  const controller = new AbortController()
  question.mockRejectedValueOnce(new Error('stdin failed'))
  await expect(promptForGate(snapshot(), control, controller.signal)).rejects.toThrow('stdin failed')
  expect(close).toHaveBeenCalledOnce()
})

it('resolves user_question gates via readline fallback in non-TTY and retries invalid input', async () => {
  const control = client()
  const origTty = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY')
  Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true })
  const log = vi.spyOn(console, 'log').mockImplementation(() => {})
  try {
    const qSnap: RunStateSnapshot = {
      ...snapshot(),
      activeGate: {
        stepId: 'step-a',
        phase: 'interactive',
        guardrailIndex: 0,
        gateType: 'user_question',
        prompt: 'Pick one',
        question: {
          type: 'select',
          prompt: 'Pick one',
          options: ['a', 'b'],
        },
        createdAt: new Date().toISOString(),
      },
    }
    question.mockResolvedValueOnce('invalid').mockResolvedValueOnce('b')
    await promptForGate(qSnap, control)
    expect(control.resolveGate).toHaveBeenCalledWith({
      stepId: 'step-a',
      guardrailIndex: 0,
      action: 'answer',
      answer: 'b',
    })

    const textSnap: RunStateSnapshot = {
      ...qSnap,
      activeGate: {
        ...qSnap.activeGate!,
        prompt: 'Enter text',
        question: { type: 'text', prompt: 'Enter text' },
      },
    }
    question.mockResolvedValueOnce('hello')
    await promptForGate(textSnap, control)
    expect(control.resolveGate).toHaveBeenLastCalledWith({
      stepId: 'step-a',
      guardrailIndex: 0,
      action: 'answer',
      answer: 'hello',
    })
  }
  finally {
    log.mockRestore()
    if (origTty)
      Object.defineProperty(process.stdin, 'isTTY', origTty)
    else
      delete (process.stdin as { isTTY?: boolean }).isTTY
  }
})

it('resolves user_question gates via Ink TTY prompter when stdin is a TTY', async () => {
  const control = client()
  const origTty = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY')
  Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true })
  try {
    const qSnap: RunStateSnapshot = {
      ...snapshot(),
      activeGate: {
        stepId: 'step-a',
        phase: 'run',
        guardrailIndex: 0,
        gateType: 'user_question',
        prompt: 'Name?',
        question: { type: 'text', prompt: 'Name?' },
        createdAt: new Date().toISOString(),
      },
    }
    promptTty.mockResolvedValueOnce('Alice')
    await promptForGate(qSnap, control)
    expect(control.resolveGate).toHaveBeenCalledWith({
      stepId: 'step-a',
      guardrailIndex: 0,
      action: 'answer',
      answer: 'Alice',
    })

    const controller = new AbortController()
    const abortErr = new Error('aborted')
    abortErr.name = 'AbortError'
    promptTty.mockImplementationOnce(async () => {
      controller.abort()
      throw abortErr
    })
    await expect(promptForGate(qSnap, control, controller.signal)).resolves.toBeUndefined()

    promptTty.mockRejectedValueOnce(new Error('tty crash'))
    await expect(promptForGate(qSnap, control)).rejects.toThrow('tty crash')
  }
  finally {
    if (origTty)
      Object.defineProperty(process.stdin, 'isTTY', origTty)
    else
      delete (process.stdin as { isTTY?: boolean }).isTTY
  }
})
