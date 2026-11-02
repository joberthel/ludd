import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'
import { stripAnsi } from '../../test-helpers.js'
import { TaskHeader } from './task-header.js'

describe('taskHeader component', () => {
  it('renders task id, name, and model', () => {
    const { lastFrame } = render(
      <TaskHeader model="gemini-2.5-pro" taskId={7} taskName="Build TUI" />,
    )

    const frame = stripAnsi(lastFrame() ?? '')
    expect(frame).toContain('Refining Task #7: Build TUI')
    expect(frame).toContain('Model: gemini-2.5-pro')
  })
})
