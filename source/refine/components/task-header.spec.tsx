import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'
import { stripAnsi } from '../../test-helpers.js'
import { TaskHeader } from './task-header.js'

describe('taskHeader component', () => {
  it('renders task id and name without model', () => {
    const { lastFrame } = render(
      <TaskHeader taskId={7} taskName="Build TUI" />,
    )

    const frame = stripAnsi(lastFrame() ?? '')
    expect(frame).toContain('Refining Task #7: Build TUI')
    expect(frame).not.toContain('Model:')
  })
})
