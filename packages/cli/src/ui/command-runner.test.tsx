import process from 'node:process'
import { render } from 'ink-testing-library'
import { afterEach, expect, it, vi } from 'vitest'
import { CommandRunner } from './command-runner.js'
import { promptInteractiveQuestionInTty, registerTtyPromptHost } from './interactive-question-prompt.js'
import { getRunUiHost } from './run-ui-bridge.js'

const originalExitCode = process.exitCode

afterEach(() => {
  process.exitCode = originalExitCode
  vi.restoreAllMocks()
})

it('renders a spinner while running and sets exitCode on success', async () => {
  let resolveRun!: (code: number) => void
  const execute = vi.fn(async () => new Promise<number>((resolve) => {
    resolveRun = resolve
  }))
  const { lastFrame, unmount } = render(
    <CommandRunner execute={execute} spinnerLabel="Working..." />,
  )
  expect(lastFrame()).toContain('Working...')
  resolveRun(0)
  await vi.waitFor(() => expect(process.exitCode).toBe(0))
  unmount()
})

it('renders an error StatusMessage and logs to stderr when execute rejects with an Error or string', async () => {
  const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  const { lastFrame, unmount } = render(
    <CommandRunner execute={async () => Promise.reject(new Error('boom'))} />,
  )
  await vi.waitFor(() => expect(lastFrame()).toContain('boom'))
  expect(process.exitCode).toBe(1)
  expect(errSpy).toHaveBeenCalledWith('boom')
  unmount()

  const third = render(
    <CommandRunner execute={vi.fn().mockRejectedValue('raw failure')} />,
  )
  await vi.waitFor(() => expect(third.lastFrame()).toContain('raw failure'))
  expect(errSpy).toHaveBeenCalledWith('raw failure')
  third.unmount()
})

it('ignores late resolution or rejection after unmount', async () => {
  let resolveRun!: (code: number) => void
  const first = render(
    <CommandRunner
      execute={async () => new Promise<number>((resolve) => {
        resolveRun = resolve
      })}
    />,
  )
  process.exitCode = undefined
  first.unmount()
  resolveRun(1)
  await Promise.resolve()
  expect(process.exitCode).toBeUndefined()

  let rejectRun!: (err: Error) => void
  const second = render(
    <CommandRunner
      execute={async () => new Promise<number>((_, reject) => {
        rejectRun = reject
      })}
    />,
  )
  second.unmount()
  rejectRun(new Error('late'))
  await Promise.resolve()
  expect(process.exitCode).toBeUndefined()
})

it('hosts interactive TTY prompts inside the existing Ink tree and preserves answered history', async () => {
  const answers: unknown[] = []
  const execute = vi.fn(async () => {
    answers.push(await promptInteractiveQuestionInTty({
      type: 'text',
      prompt: 'Favorite color?',
      default: 'blue',
    }))
    answers.push(await promptInteractiveQuestionInTty({
      type: 'confirm',
      prompt: 'Proceed?',
      default: true,
    }))
    answers.push(await promptInteractiveQuestionInTty({
      type: 'confirm',
      prompt: 'Skip?',
      default: false,
    }))
    answers.push(await promptInteractiveQuestionInTty({
      type: 'multi-select',
      prompt: 'Tags?',
      options: ['a', 'b'],
      default: ['a', 'b'],
    }))
    return 0
  })
  const flushEffects = async () => new Promise(resolve => setTimeout(resolve, 25))
  const { lastFrame, stdin, unmount } = render(<CommandRunner execute={execute} />)
  await vi.waitFor(() => expect(lastFrame()).toContain('Favorite color?'))
  await flushEffects()
  stdin.write('\r')
  await vi.waitFor(() => expect(lastFrame()).toContain('Proceed?'))
  await flushEffects()
  stdin.write('y')
  await vi.waitFor(() => expect(lastFrame()).toContain('Skip?'))
  await flushEffects()
  stdin.write('n')
  await vi.waitFor(() => expect(lastFrame()).toContain('Tags?'))
  await flushEffects()
  stdin.write('\r')
  await vi.waitFor(() => expect(process.exitCode).toBe(0))
  expect(answers).toEqual([
    'blue',
    true,
    false,
    ['a', 'b'],
  ])
  expect(lastFrame()).toContain('Favorite color?')
  expect(lastFrame()).toContain('blue')
  expect(lastFrame()).toContain('Proceed?')
  expect(lastFrame()).toContain('yes')
  expect(lastFrame()).toContain('Skip?')
  expect(lastFrame()).toContain('no')
  expect(lastFrame()).toContain('a, b')
  const unregisterSecond = registerTtyPromptHost(() => {})
  unmount()
  unregisterSecond()
})

it('registers RunUiHost in TTY mode and renders pushed entries and live activity', async () => {
  const origTty = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY')
  Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true })
  try {
    let finish!: (code: number) => void
    const execute = vi.fn(async () => new Promise<number>((resolve) => {
      finish = resolve
    }))
    const { lastFrame, unmount } = render(<CommandRunner execute={execute} />)
    await vi.waitFor(() => expect(getRunUiHost()).toBeDefined())
    getRunUiHost()!.pushEntry({ kind: 'step.started', stepId: 'build' })
    getRunUiHost()!.setActivity('build · thinking...')
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('▸ build')
      expect(lastFrame()).toContain('build · thinking...')
    })
    finish(0)
    await vi.waitFor(() => expect(process.exitCode).toBe(0))
    unmount()
    expect(getRunUiHost()).toBeUndefined()
  }
  finally {
    if (origTty)
      Object.defineProperty(process.stdout, 'isTTY', origTty)
    else
      delete (process.stdout as { isTTY?: boolean }).isTTY
  }
})
