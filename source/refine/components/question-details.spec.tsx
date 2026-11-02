import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'
import { stripAnsi } from '../../test-helpers.js'
import { QuestionDetails } from './question-details.js'

describe('questionDetails component', () => {
  it('renders hypothesis, confidence, question, and guess without missing or answer', () => {
    const { lastFrame } = render(
      <QuestionDetails
        confidence={80}
        guess="Guess value"
        hypothesis="Test hypothesis"
        question="What is the answer?"
      />,
    )

    const frame = stripAnsi(lastFrame() ?? '')
    expect(frame).toContain('HYPOTHESIS: Test hypothesis')
    expect(frame).toContain('CONFIDENCE: 80%')
    expect(frame).toContain('Q: What is the answer?')
    expect(frame).toContain('GUESS: Guess value')
    expect(frame).not.toContain('MISSING:')
    expect(frame).not.toContain('ANSWER:')
  })

  it('renders missing and answer when provided', () => {
    const { lastFrame } = render(
      <QuestionDetails
        answer="Submitted answer"
        confidence={65}
        guess="Guessed"
        hypothesis="Hypothesis"
        missing="Missing info"
        question="Question?"
      />,
    )

    const frame = stripAnsi(lastFrame() ?? '')
    expect(frame).toContain('MISSING: Missing info')
    expect(frame).toContain('ANSWER: Submitted answer')
  })
})
