import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'
import { stripAnsi } from '../../test-helpers.js'
import { QuestionDetails } from './question-details.js'

describe('questionDetails component', () => {
  it('renders question and guess without answer, hypothesis, confidence, or missing', () => {
    const { lastFrame } = render(
      <QuestionDetails
        guess="Guess value"
        question="What is the answer?"
      />,
    )

    const frame = stripAnsi(lastFrame() ?? '')
    expect(frame).toContain('Q: What is the answer?')
    expect(frame).toContain('GUESS: Guess value')
    expect(frame).not.toContain('HYPOTHESIS:')
    expect(frame).not.toContain('CONFIDENCE:')
    expect(frame).not.toContain('MISSING:')
    expect(frame).not.toContain('ANSWER:')
  })

  it('renders answer when provided', () => {
    const { lastFrame } = render(
      <QuestionDetails
        answer="Submitted answer"
        guess="Guessed"
        question="Question?"
      />,
    )

    const frame = stripAnsi(lastFrame() ?? '')
    expect(frame).toContain('Q: Question?')
    expect(frame).toContain('GUESS: Guessed')
    expect(frame).toContain('ANSWER: Submitted answer')
    expect(frame).not.toContain('HYPOTHESIS:')
    expect(frame).not.toContain('CONFIDENCE:')
    expect(frame).not.toContain('MISSING:')
  })
})
