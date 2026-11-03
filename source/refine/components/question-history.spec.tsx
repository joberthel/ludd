import type { QnATurn } from './question-history.js'
import { render } from 'ink-testing-library'
import { describe, expect, it, vi } from 'vitest'
import { pressKey, stripAnsi } from '../../test-helpers.js'
import { QuestionHistory } from './question-history.js'

const mockHistory: QnATurn[] = [
  {
    confidence: 60,
    question: 'Should theme be persisted?',
    guess: 'Yes in localStorage',
    answer: 'Yes in localStorage',
  },
  {
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
      expect(frame).toContain('Q: Should system match prefers-color-scheme?')
      expect(frame).toContain('GUESS: Yes')
      expect(frame).toContain('ANSWER: Yes, match OS')
      expect(frame).not.toContain('HYPOTHESIS:')
      expect(frame).not.toContain('CONFIDENCE:')
    })

    // Press PageUp again -> should view turn 1/2
    await pressKey(stdin, '\x1B[5~')

    await vi.waitFor(() => {
      const frame = stripAnsi(lastFrame() ?? '')
      expect(frame).toContain('[History 1/2 - PageUp/PageDown]')
      expect(frame).toContain('Q: Should theme be persisted?')
      expect(frame).toContain('GUESS: Yes in localStorage')
      expect(frame).toContain('ANSWER: Yes in localStorage')
      expect(frame).not.toContain('HYPOTHESIS:')
      expect(frame).not.toContain('CONFIDENCE:')
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
    expect(frame).toContain('Q: Should theme be persisted?')
    expect(frame).toContain('GUESS: Yes in localStorage')
    expect(frame).toContain('ANSWER: Yes in localStorage')
    expect(frame).not.toContain('HYPOTHESIS:')
    expect(frame).not.toContain('CONFIDENCE:')
  })

  it('returns to active prompt when pressing Escape while viewing history', async () => {
    const { lastFrame, stdin } = render(
      <QuestionHistory history={mockHistory} />,
    )

    // Navigate to history turn
    await pressKey(stdin, '\x1B[5~')
    await vi.waitFor(() => {
      expect(stripAnsi(lastFrame() ?? '')).toContain('[History 2/2 - PageUp/PageDown]')
    })

    // Press Escape
    await pressKey(stdin, '\x1B')
    await vi.waitFor(() => {
      const frame = stripAnsi(lastFrame() ?? '')
      expect(frame).toContain('[History: 2 past turn(s) - press PageUp to view]')
      expect(frame).not.toContain('HYPOTHESIS:')
    })
  })
})
