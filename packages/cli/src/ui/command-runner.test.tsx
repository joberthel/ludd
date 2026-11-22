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

it('renders split-pane RunDashboard in TTY dashboard mode, manages alt-screen, and prints final summary on exit', async () => {
  const origTty = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY')
  Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true })
  const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  try {
    let finish!: (code: number) => void
    const execute = vi.fn(async () => new Promise<number>((resolve) => {
      finish = resolve
    }))
    const { lastFrame, stdin, unmount } = render(<CommandRunner execute={execute} dashboard={true} />)
    await vi.waitFor(() => expect(getRunUiHost()).toBeDefined())

    expect(writeSpy).toHaveBeenCalledWith('\x1B[?1049h\x1B[2J\x1B[H')

    getRunUiHost()!.setBlueprint?.({
      harnessName: 'dash-demo',
      steps: [
        { id: 'triage', hasMatrix: false },
        { id: 'implement', hasMatrix: true },
      ],
    })
    getRunUiHost()!.pushEntry({
      kind: 'step.started',
      stepId: 'triage',
      scope: { stepId: 'triage' },
    })
    getRunUiHost()!.pushEntry({
      kind: 'agent.text',
      text: 'Inspecting repo',
      scope: { stepId: 'triage', phase: 'run' },
    })
    getRunUiHost()!.pushEntry({
      kind: 'step.passed',
      stepId: 'triage',
      scope: { stepId: 'triage' },
    })

    await vi.waitFor(() => {
      const frame = lastFrame()!
      expect(frame).toContain('◆ dash-demo')
      expect(frame).toContain('Steps')
      expect(frame).toContain('Inspecting repo')
    })

    finish(0)
    await vi.waitFor(() => {
      expect(process.exitCode).toBe(0)
      expect(lastFrame()).toContain('Press q or Esc to exit')
      expect(lastFrame()).toContain('q/Esc: exit')
    })
    expect(writeSpy).not.toHaveBeenCalledWith('\x1B[?1049l')

    // User can still navigate panes after run finishes
    await new Promise(resolve => setTimeout(resolve, 20))
    stdin.write('j')
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('follow:off')
    })

    // Pressing q dismisses dashboard, exits alt-screen, and prints FinalRunSummary
    stdin.write('q')
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('✔ dash-demo — Run passed')
      expect(lastFrame()).toContain('✔ triage (passed)')
      expect(writeSpy).toHaveBeenCalledWith('\x1B[?1049l')
    })
    expect(process.exitCode).toBe(0)
    unmount()
  }
  finally {
    if (origTty)
      Object.defineProperty(process.stdout, 'isTTY', origTty)
    else
      delete (process.stdout as { isTTY?: boolean }).isTTY
  }
})

it('handles hydrateSnapshot, guardrails, gates, prompts, and failed summary in dashboard mode', async () => {
  const origTty = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY')
  Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true })
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    const execute = vi.fn(async () => {
      const host = getRunUiHost()!
      host.setBlueprint?.({
        harnessName: 'resume-demo',
        steps: [
          { id: 's1', hasMatrix: false },
          { id: 's2', hasMatrix: false },
          { id: 's3', hasMatrix: false },
        ],
      })
      host.hydrateSnapshot?.({
        schemaVersion: 1,
        runId: 'r1',
        harnessName: 'resume-demo',
        workflowName: 'resume-demo',
        status: 'running',
        activeStepId: 's2',
        steps: {
          s1: { status: 'skipped', output: undefined },
        },
        updatedAt: new Date().toISOString(),
      })
      host.setActivity('s2 · checking')
      host.upsertEntry?.('thought:s2:0', {
        kind: 'agent.thought',
        text: 'thinking...',
        streaming: true,
        scope: { stepId: 's2', phase: 'run' },
      })
      host.onGuardrailStarted?.({ stepId: 's2', phase: 'afterStep', guardrailIndex: 0 })
      host.setGateWaiting?.(true, { stepId: 's2', phase: 'afterStep', guardrailIndex: 0 })
      const ans = await promptInteractiveQuestionInTty({
        type: 'text',
        prompt: 'Continue?',
        default: 'ok',
      })
      expect(ans).toBe('ok')
      host.setGateWaiting?.(false, { stepId: 's2', phase: 'afterStep', guardrailIndex: 0 })
      host.pushEntry({
        kind: 'step.failed',
        stepId: 's2',
        error: 'bad',
        scope: { stepId: 's2' },
      })
      throw new Error('run exploded')
    })

    const { lastFrame, stdin, unmount } = render(<CommandRunner execute={execute} dashboard={true} />)
    await vi.waitFor(() => expect(lastFrame()).toContain('Continue?'))
    await new Promise(resolve => setTimeout(resolve, 25))
    stdin.write('\r')

    await vi.waitFor(() => {
      expect(process.exitCode).toBe(1)
      const frame = lastFrame()!
      expect(frame).toContain('◆ resume-demo [failed]')
      expect(frame).toContain('✖ run exploded')
      expect(frame).toContain('q/Esc: exit')
    })
    expect(errSpy).not.toHaveBeenCalled()

    await new Promise(resolve => setTimeout(resolve, 25))
    stdin.write('\x1B')
    await vi.waitFor(() => {
      const frame = lastFrame()!
      expect(frame).toContain('✖ resume-demo — Run failed: run exploded')
      expect(frame).toContain('↷ s1 (skipped)')
      expect(frame).toContain('✖ s2 (failed)')
      expect(frame).toContain('○ s3 (pending)')
    })
    expect(errSpy).toHaveBeenCalledWith('run exploded')
    unmount()

    // Non-throwing failure (exit code 1 with run.failed entry, no errorMessage)
    const failedQuiet = render(
      <CommandRunner
        execute={async () => {
          getRunUiHost()!.pushEntry({ kind: 'run.failed' })
          return 1
        }}
        dashboard={true}
      />,
    )
    await vi.waitFor(() => {
      expect(failedQuiet.lastFrame()).toContain('q/Esc: exit')
    })
    await new Promise(resolve => setTimeout(resolve, 25))
    failedQuiet.stdin.write('q')
    await vi.waitFor(() => {
      expect(failedQuiet.lastFrame()).toContain('✖ ludd — Run failed')
    })
    failedQuiet.unmount()
  }
  finally {
    if (origTty)
      Object.defineProperty(process.stdout, 'isTTY', origTty)
    else
      delete (process.stdout as { isTTY?: boolean }).isTTY
  }
})

it('exits dashboard immediately when keepOpen is false or on pre-run startup error', async () => {
  const origTty = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY')
  Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true })
  const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    // keepOpen={false} exits immediately on finish
    const autoExit = render(
      <CommandRunner
        execute={async () => {
          getRunUiHost()!.setBlueprint?.({
            harnessName: 'auto-demo',
            steps: [
              { id: 's1', hasMatrix: false },
            ],
          })
          getRunUiHost()!.pushEntry({
            kind: 'step.passed',
            stepId: 's1',
            scope: { stepId: 's1' },
          })
          return 0
        }}
        dashboard={true}
        keepOpen={false}
      />,
    )
    await vi.waitFor(() => {
      expect(autoExit.lastFrame()).toContain('✔ auto-demo — Run passed')
      expect(writeSpy).toHaveBeenCalledWith('\x1B[?1049l')
    })
    autoExit.unmount()

    // Pre-run startup error (no steps or entries pushed) exits immediately even when keepOpen={true}
    const startupFail = render(
      <CommandRunner
        execute={async () => {
          throw new Error('Config not found')
        }}
        dashboard={true}
        keepOpen={true}
      />,
    )
    await vi.waitFor(() => {
      expect(process.exitCode).toBe(1)
      expect(startupFail.lastFrame()).toContain('✖ ludd — Run failed: Config not found')
      expect(errSpy).toHaveBeenCalledWith('Config not found')
      expect(writeSpy).toHaveBeenCalledWith('\x1B[?1049l')
    })
    startupFail.unmount()
  }
  finally {
    if (origTty)
      Object.defineProperty(process.stdout, 'isTTY', origTty)
    else
      delete (process.stdout as { isTTY?: boolean }).isTTY
  }
})
