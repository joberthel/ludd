import chalk from 'chalk'
import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'
import { stripAnsi } from '../../test-helpers.js'
import { Statusbar } from './statusbar.js'

describe('statusbar component', () => {
  it('renders all status segments correctly', () => {
    const { lastFrame } = render(
      <Statusbar
        agyStatus="Running"
        confidence={75}
        historyCount={2}
        mcpStatus="Connected"
        model="gemini-2.5-pro"
      />,
    )

    const frame = stripAnsi(lastFrame() ?? '')
    expect(frame).toContain('Confidence: 75%')
    expect(frame).toContain('Model: gemini-2.5-pro')
    expect(frame).toContain('MCP: Connected')
    expect(frame).toContain('Agent: Running')
    expect(frame).toContain('[PgUp/PgDn] History (2)')
  })

  it('renders color thresholds for confidence', () => {
    // < 70% -> yellow
    const { lastFrame: frameLow } = render(
      <Statusbar
        confidence={60}
        mcpStatus="Connected"
        model="gemini-2.5-pro"
      />,
    )
    expect(frameLow() ?? '').toContain(chalk.yellow('60%'))

    // 70%..94% -> green
    const { lastFrame: frameMid } = render(
      <Statusbar
        confidence={80}
        mcpStatus="Connected"
        model="gemini-2.5-pro"
      />,
    )
    expect(frameMid() ?? '').toContain(chalk.green('80%'))

    // >= 95% -> cyan
    const { lastFrame: frameHigh } = render(
      <Statusbar
        confidence={95}
        mcpStatus="Connected"
        model="gemini-2.5-pro"
      />,
    )
    expect(frameHigh() ?? '').toContain(chalk.cyan('95%'))
  })

  it('renders fallback when confidence is undefined', () => {
    const { lastFrame } = render(
      <Statusbar
        mcpStatus="Starting"
        model="gemini-2.5-flash"
      />,
    )

    const frame = stripAnsi(lastFrame() ?? '')
    expect(frame).toContain('Confidence: --%')
    expect(frame).toContain('Model: gemini-2.5-flash')
    expect(frame).toContain('MCP: Starting')
    expect(frame).toContain('[PgUp/PgDn] History')
  })
})
