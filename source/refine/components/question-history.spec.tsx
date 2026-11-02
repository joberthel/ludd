import type { QnATurn } from './question-history.js'
import { render } from 'ink-testing-library'
import { describe, expect, it, vi } from 'vitest'
import { pressKey } from '../../test-helpers.js'
import { QuestionHistory } from './question-history.js'

function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1B\[[0-9;]*[a-z]/gi, '')
}

const mockHistory: QnATurn[] = [
  {
    hypothesis: 'User wants dark mode by default',
    confidence: 60,
    missing: 'theme persistence',
    question: 'Should theme be persisted?',
    guess: 'Yes in localStorage',
    answer: 'Yes in localStorage',
  },
  {
    hypothesis: 'System should respect OS dark mode preference',
    confidence: 85,
    question: 'Should system match prefers-color-scheme?',
    guess: 'Yes',
    answer: 'Yes, match OS',
  },
]

describe('questionHistory component', () => {
  it('renders nothing when history is empty', () => {
    const { lastFrame } = render(
      <QuestionHistory history={[]} />,
    )

    expect(lastFrame()).toBe('')
  })

  it('renders past turns count hint when viewing active prompt', () => {
    const { lastFrame } = render(
      <QuestionHistory history={mockHistory} />,
    )

    const frame = stripAnsi(lastFrame() ?? '')
    expect(frame).toContain('[History: 2 past turn(s) - press PageUp to view]')
    expect(frame).not.toContain('HYPOTHESIS:')
  })

  it('navigates backwards with PageUp and forwards with PageDown', async () => {
    const { lastFrame, stdin } = render(
      <QuestionHistory history={mockHistory} />,
    )

    // Press PageUp (\x1B[5~) -> should view turn 2/2
    await pressKey(stdin, '\x1B[5~')

    await vi.waitFor(() => {
      const frame = stripAnsi(lastFrame() ?? '')
      expect(frame).toContain('[History 2/2 - PageUp/PageDown]')
      expect(frame).toContain('System should respect OS dark mode preference')
      expect(frame).toContain('CONFIDENCE: 85%')
      expect(frame).toContain('ANSWER: Yes, match OS')
    })

    // Press PageUp again -> should view turn 1/2
    await pressKey(stdin, '\x1B[5~')

    await vi.waitFor(() => {
      const frame = stripAnsi(lastFrame() ?? '')
      expect(frame).toContain('[History 1/2 - PageUp/PageDown]')
      expect(frame).toContain('User wants dark mode by default')
      expect(frame).toContain('MISSING: theme persistence')
      expect(frame).toContain('ANSWER: Yes in localStorage')
    })

    // Press PageDown (\x1B[6~) -> should return to turn 2/2
    await pressKey(stdin, '\x1B[6~')

    await vi.waitFor(() => {
      const frame = stripAnsi(lastFrame() ?? '')
      expect(frame).toContain('[History 2/2 - PageUp/PageDown]')
    })

    // Press PageDown again -> should return to active prompt hint
    await pressKey(stdin, '\x1B[6~')

    await vi.waitFor(() => {
      const frame = stripAnsi(lastFrame() ?? '')
      expect(frame).toContain('[History: 2 past turn(s) - press PageUp to view]')
      expect(frame).not.toContain('HYPOTHESIS:')
    })
  })

  it('renders controlled selectedIndex correctly', () => {
    const { lastFrame } = render(
      <QuestionHistory
        history={mockHistory}
        selectedIndex={0}
      />,
    )

    const frame = stripAnsi(lastFrame() ?? '')
    expect(frame).toContain('[History 1/2 - PageUp/PageDown]')
    expect(frame).toContain('User wants dark mode by default')
    expect(frame).toContain('MISSING: theme persistence')
  })
})
