import type { ActiveTtyPrompt } from './interactive-question-prompt.js'
import { render } from 'ink-testing-library'
import { useReducer } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { RunDashboard } from './run-dashboard.js'
import { createInitialRunTreeState, runTreeReducer } from './run-tree-state.js'

function DashboardHarness({
  activePrompt,
  onPromptSubmit = vi.fn(),
}: {
  activePrompt?: ActiveTtyPrompt
  onPromptSubmit?: (answer: unknown) => void
}) {
  const initial = (() => {
    let s = createInitialRunTreeState('demo')
    s = runTreeReducer(s, {
      type: 'SET_BLUEPRINT',
      blueprint: {
        harnessName: 'demo',
        steps: [
          { id: 'triage', hasMatrix: false },
          { id: 'implement', hasMatrix: true },
        ],
      },
    })
    s = runTreeReducer(s, {
      type: 'PUSH_ENTRY',
      entry: {
        kind: 'step.started',
        stepId: 'triage',
        scope: { stepId: 'triage' },
      },
    })
    s = runTreeReducer(s, {
      type: 'PUSH_ENTRY',
      entry: {
        kind: 'agent.text',
        text: 'Triage log line',
        scope: { stepId: 'triage', phase: 'run' },
      },
    })
    return s
  })()

  const [state, dispatch] = useReducer(runTreeReducer, initial)

  return (
    <RunDashboard
      state={state}
      dispatch={dispatch}
      activePrompt={activePrompt}
      status="running"
      onPromptSubmit={onPromptSubmit}
      useAltScreen={false}
    />
  )
}

describe('runDashboard', () => {
  it('renders split panes and switches focus between tree and logs on Tab', async () => {
    const { lastFrame, stdin, unmount } = render(<DashboardHarness />)
    const frame = lastFrame()!
    expect(frame).toContain('◆ demo')
    expect(frame).toContain('Steps')
    expect(frame).toContain('Triage log line')
    expect(frame).toContain('Tab: switch pane')

    await new Promise(resolve => setTimeout(resolve, 20))
    // Toggle expand and toggle follow in tree pane
    stdin.write('\r')
    stdin.write('j')
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('follow:off')
    })
    stdin.write('f')
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('follow:on')
    })
    stdin.write('j')
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('follow:off')
    })

    // Tab switches to log pane and back to tree pane
    stdin.write('\t')
    await new Promise(resolve => setTimeout(resolve, 20))
    stdin.write('f')
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(lastFrame()).toContain('follow:off')
    stdin.write('\t')
    await new Promise(resolve => setTimeout(resolve, 20))
    stdin.write('f')
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('follow:on')
    })
    unmount()
  })

  it('shows question modal and lets user minimize with Ctrl+B to inspect logs', async () => {
    const onPromptSubmit = vi.fn()
    const prompt: ActiveTtyPrompt = {
      question: {
        type: 'text',
        prompt: 'Proceed with deploy?',
        default: 'yes',
      },
      onSubmit: onPromptSubmit,
    }

    const { lastFrame, stdin, unmount } = render(
      <DashboardHarness activePrompt={prompt} onPromptSubmit={onPromptSubmit} />,
    )

    expect(lastFrame()).toContain('Proceed with deploy?')

    await new Promise(resolve => setTimeout(resolve, 20))
    stdin.write('\x02')
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('Question waiting — press Ctrl+B to answer')
      expect(lastFrame()).not.toContain('Proceed with deploy?')
    })

    stdin.write('\x02')
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('Proceed with deploy?')
    })

    stdin.write('\r')
    await vi.waitFor(() => {
      expect(onPromptSubmit).toHaveBeenCalledWith('yes')
    })
    unmount()
  })

  it('preserves typed modal input when minimized with Ctrl+B to interact with background panes', async () => {
    const onPromptSubmit = vi.fn()
    const prompt: ActiveTtyPrompt = {
      question: {
        type: 'text',
        prompt: 'Commit message?',
      },
      onSubmit: onPromptSubmit,
    }

    const { lastFrame, stdin, unmount } = render(
      <DashboardHarness activePrompt={prompt} onPromptSubmit={onPromptSubmit} />,
    )

    expect(lastFrame()).toContain('Commit message?')

    await new Promise(resolve => setTimeout(resolve, 20))
    stdin.write('feat: ship')
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('feat: ship')
    })

    // Minimize modal with Ctrl+B
    stdin.write('\x02')
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('Question waiting — press Ctrl+B to answer')
      expect(lastFrame()).not.toContain('Commit message?')
    })

    // Interact with background panes while minimized
    stdin.write('\r')
    stdin.write('j')
    stdin.write('\t')
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('follow:off')
    })
    expect(onPromptSubmit).not.toHaveBeenCalled()

    // Restore modal with Ctrl+B and verify input is intact without 'b' or background keys
    stdin.write('\x02')
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('Commit message?')
      expect(lastFrame()).toContain('feat: ship')
      expect(lastFrame()).not.toContain('feat: shipb')
      expect(lastFrame()).not.toContain('feat: shipj')
    })

    stdin.write('\r')
    await vi.waitFor(() => {
      expect(onPromptSubmit).toHaveBeenCalledWith('feat: ship')
    })
    unmount()
  })

  it('renders passed, failed, waiting_for_gate, error footer, activity, and handles resize', async () => {
    const base = createInitialRunTreeState('demo')
    const passedState = { ...base, runStatus: 'passed' as const, activity: 'finishing...' }
    const { lastFrame, rerender, unmount } = render(
      <RunDashboard
        state={passedState}
        dispatch={vi.fn()}
        status="done"
        onPromptSubmit={vi.fn()}
        useAltScreen={false}
      />,
    )
    expect(lastFrame()).toContain('[passed]')
    expect(lastFrame()).toContain('finishing...')

    rerender(
      <RunDashboard
        state={{ ...base, runStatus: 'waiting_for_gate' }}
        dispatch={vi.fn()}
        status="running"
        onPromptSubmit={vi.fn()}
        useAltScreen={false}
      />,
    )
    expect(lastFrame()).toContain('[waiting for gate]')

    rerender(
      <RunDashboard
        state={{ ...base, runStatus: 'failed' }}
        dispatch={vi.fn()}
        status="error"
        errorMessage="step crashed"
        onPromptSubmit={vi.fn()}
        useAltScreen={false}
      />,
    )
    expect(lastFrame()).toContain('[failed]')
    expect(lastFrame()).toContain('✖ step crashed')

    process.stdout.emit('resize')
    unmount()
  })

  it('displays selected node status circle, agent thoughts, and guardrail output in right pane', async () => {
    let state = createInitialRunTreeState('demo')
    state = runTreeReducer(state, {
      type: 'SET_BLUEPRINT',
      blueprint: {
        harnessName: 'demo',
        steps: [
          {
            id: 'triage',
            hasMatrix: false,
            afterStep: [
              { index: 0, name: 'lint' },
            ],
          },
        ],
      },
    })
    state = runTreeReducer(state, {
      type: 'PUSH_ENTRY',
      entry: {
        kind: 'step.started',
        stepId: 'triage',
        scope: { stepId: 'triage' },
      },
    })
    state = runTreeReducer(state, {
      type: 'UPSERT_ENTRY',
      streamKey: 'thought:s1:0',
      entry: {
        kind: 'agent.thought',
        text: 'Checking edge cases',
        streaming: true,
        scope: { stepId: 'triage', phase: 'run' },
      },
    })
    state = runTreeReducer(state, {
      type: 'PUSH_ENTRY',
      entry: {
        kind: 'guardrail.failed',
        name: 'lint',
        output: 'Lint error on line 42',
        scope: { stepId: 'triage', phase: 'afterStep', guardrailIndex: 0 },
      },
    })
    state = runTreeReducer(state, {
      type: 'SET_ACTIVITY',
      activity: 'triage · running guardrail lint...',
    })
    state = runTreeReducer(state, {
      type: 'SELECT_NODE',
      nodeId: 'step:triage',
    })

    const { lastFrame, unmount } = render(
      <RunDashboard
        state={state}
        dispatch={vi.fn()}
        status="running"
        onPromptSubmit={vi.fn()}
        useAltScreen={false}
      />,
    )
    const frame = lastFrame()!
    expect(frame).toContain('●')
    expect(frame).toContain('Checking edge cases')
    expect(frame).toContain('Lint error on line 42')
    expect(frame).toContain('t: thoughts · o: output')
    unmount()
  })

  it('calls onExit on q or Esc only when finished/errored, renders exit hints, and keeps navigation active', async () => {
    const onExit = vi.fn()
    let initial = createInitialRunTreeState('demo')
    initial = runTreeReducer(initial, {
      type: 'SET_BLUEPRINT',
      blueprint: {
        harnessName: 'demo',
        steps: [
          { id: 'triage', hasMatrix: false },
          { id: 'implement', hasMatrix: false },
        ],
      },
    })

    function InteractiveFinishedHarness({ status, errorMessage }: { status: 'running' | 'done' | 'error', errorMessage?: string }) {
      const [state, dispatch] = useReducer(runTreeReducer, {
        ...initial,
        runStatus: status === 'running'
          ? 'running'
          : status === 'done'
            ? 'passed'
            : 'failed',
      })
      return (
        <RunDashboard
          state={state}
          dispatch={dispatch}
          status={status}
          errorMessage={errorMessage}
          onPromptSubmit={vi.fn()}
          onExit={onExit}
          useAltScreen={false}
        />
      )
    }

    // While running, q and Esc should NOT trigger onExit
    const running = render(<InteractiveFinishedHarness status="running" />)
    await new Promise(resolve => setTimeout(resolve, 20))
    running.stdin.write('q')
    running.stdin.write('\x1B')
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(onExit).not.toHaveBeenCalled()
    expect(running.lastFrame()).not.toContain('q/Esc: exit')
    running.unmount()

    // When done, navigation still works and q/Esc calls onExit
    const done = render(<InteractiveFinishedHarness status="done" />)
    await vi.waitFor(() => {
      const frame = done.lastFrame()!
      expect(frame).toContain('Press q or Esc to exit')
      expect(frame).toContain('q/Esc: exit')
    })
    await new Promise(resolve => setTimeout(resolve, 20))
    done.stdin.write('j')
    await vi.waitFor(() => {
      expect(done.lastFrame()).toContain('follow:off')
    })
    done.stdin.write('\t')
    await new Promise(resolve => setTimeout(resolve, 20))
    done.stdin.write('q')
    await vi.waitFor(() => expect(onExit).toHaveBeenCalledTimes(1))
    done.unmount()

    // When errored, error message and q/Esc: exit are both shown, and Esc calls onExit
    const errored = render(<InteractiveFinishedHarness status="error" errorMessage="step crashed" />)
    await vi.waitFor(() => {
      const frame = errored.lastFrame()!
      expect(frame).toContain('✖ step crashed')
      expect(frame).toContain('q/Esc: exit')
      expect(frame).toContain('Press q or Esc to exit')
    })
    await new Promise(resolve => setTimeout(resolve, 20))
    errored.stdin.write('\x1B')
    await vi.waitFor(() => expect(onExit).toHaveBeenCalledTimes(2))
    errored.unmount()
  })
})
