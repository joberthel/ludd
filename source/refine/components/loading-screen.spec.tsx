import chalk from 'chalk'
import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'
import { LoadingScreen } from './loading-screen.js'

function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1B\[[0-9;]*[a-z]/gi, '')
}

describe('loadingScreen component', () => {
  it('renders header banner with task info and model', () => {
    const { lastFrame } = render(
      <LoadingScreen
        model="gemini-2.5-pro"
        stage="starting-mcp"
        taskId={42}
        taskName="Refactor Auth"
      />,
    )

    const frame = stripAnsi(lastFrame() ?? '')
    expect(frame).toContain('Refining Task #42: Refactor Auth')
    expect(frame).toContain('Model: gemini-2.5-pro')
  })

  it('renders active spinner on starting-mcp stage', () => {
    const { lastFrame } = render(
      <LoadingScreen
        model="gemini-2.5-pro"
        stage="starting-mcp"
        taskId={1}
        taskName="Task 1"
      />,
    )

    const frame = stripAnsi(lastFrame() ?? '')
    expect(frame).toContain('Starting MCP server...')
    expect(frame).toContain('[ ] Verifying refinement skill')
    expect(frame).toContain('[ ] Launching agy agent session')
    expect(frame).not.toContain('[OK]')
  })

  it('renders [OK] for MCP server and spinner for skill in verifying-skill stage', () => {
    const { lastFrame } = render(
      <LoadingScreen
        mcpPort={12345}
        model="gemini-2.5-pro"
        stage="verifying-skill"
        taskId={1}
        taskName="Task 1"
      />,
    )

    const frame = lastFrame() ?? ''
    expect(frame).toContain(chalk.green('[OK]'))
    expect(frame).toContain('MCP server started (port 12345)')
    expect(frame).toContain('Verifying refinement skill...')
    expect(frame).toContain('[ ] Launching agy agent session')
  })

  it('renders [OK] for MCP and skill, spinner for agent in spawning-agent stage', () => {
    const { lastFrame } = render(
      <LoadingScreen
        model="gemini-2.5-pro"
        stage="spawning-agent"
        taskId={1}
        taskName="Task 1"
      />,
    )

    const frame = lastFrame() ?? ''
    expect(frame).toContain(chalk.green('[OK]'))
    expect(frame).toContain('Refinement skill verified')
    expect(frame).toContain('Launching agy agent session...')
  })

  it('renders [OK] for all milestones and waiting spinner in waiting-agent-first-question stage', () => {
    const { lastFrame } = render(
      <LoadingScreen
        agentPid={9999}
        mcpPort={8080}
        model="gemini-2.5-pro"
        stage="waiting-agent-first-question"
        taskId={1}
        taskName="Task 1"
      />,
    )

    const frame = stripAnsi(lastFrame() ?? '')
    expect(frame).toContain('[OK] MCP server started (port 8080)')
    expect(frame).toContain('[OK] Refinement skill verified')
    expect(frame).toContain('[OK] agy agent session launched (PID 9999)')
    expect(frame).toContain('Waiting for agent to formulate first question...')
  })
})
