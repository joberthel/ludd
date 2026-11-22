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
})
