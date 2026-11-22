import type { KeyedRunUiEntry } from './run-tree-state.js'
import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'
import { LogViewerPane } from './log-viewer-pane.js'
import { StatusCircle } from './status-circle.js'

function makeEntries(count: number): KeyedRunUiEntry[] {
  return Array.from({ length: count }, (_, idx) => ({
    id: idx,
    kind: 'agent.text' as const,
    text: `line-${idx + 1}`,
  }))
}

describe('logViewerPane', () => {
  it('renders empty state when no logs match', () => {
    const { lastFrame, unmount } = render(
      <LogViewerPane
        breadcrumb="demo › triage"
        selectedNodeId="step:triage"
        entries={[]}
        focused={false}
        width={60}
        height={10}
      />,
    )
    const frame = lastFrame()!
    expect(frame).toContain('demo › triage')
    expect(frame).toContain('0 entries')
    expect(frame).toContain('No logs for this selection yet.')
    unmount()
  })

  it('auto-scrolls to bottom and supports g/G and arrow scrolling when focused', async () => {
    const entries = makeEntries(12)
    const { lastFrame, stdin, unmount } = render(
      <LogViewerPane
        breadcrumb="demo › impl"
        selectedNodeId="step:impl"
        entries={entries}
        focused={true}
        width={60}
        height={8}
      />,
    )

    // height=8 => viewportHeight=5 => shows line-8..line-12
    expect(lastFrame()).toContain('line-12')
    expect(lastFrame()).not.toContain('line-1\n')

    await new Promise(resolve => setTimeout(resolve, 20))
    stdin.write('g')
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(lastFrame()).toContain('line-1')
    expect(lastFrame()).not.toContain('line-12')

    stdin.write('G')
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(lastFrame()).toContain('line-12')

    // Scroll up 1 line with k, then back down with j to re-enable autoScroll
    stdin.write('k')
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(lastFrame()).toContain('7/12')
    stdin.write('j')
    await new Promise(resolve => setTimeout(resolve, 20))

    // From top, j and pageDown do not reach bottom on a 20-entry list
    const big = render(
      <LogViewerPane
        breadcrumb="demo › big"
        selectedNodeId="step:big"
        entries={makeEntries(20)}
        focused={true}
        width={60}
        height={8}
      />,
    )
    await new Promise(resolve => setTimeout(resolve, 20))
    big.stdin.write('g')
    await new Promise(resolve => setTimeout(resolve, 20))
    big.stdin.write('j')
    await new Promise(resolve => setTimeout(resolve, 20))
    big.stdin.write('\x1B[6~')
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(big.lastFrame()).toContain('6/20')
    big.unmount()

    // PageUp (\x1b[5~) and PageDown (\x1b[6~)
    stdin.write('\x1B[5~')
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(lastFrame()).toContain('line-4')
    stdin.write('\x1B[6~')
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(lastFrame()).toContain('line-12')

    // Test single entry label
    const single = render(
      <LogViewerPane
        breadcrumb="demo › single"
        selectedNodeId="step:single"
        entries={makeEntries(1)}
        focused={false}
        width={60}
        height={8}
      />,
    )
    expect(single.lastFrame()).toContain('1 entry')
    single.unmount()
    unmount()
  })

  it('renders status circles, live activity footer, and supports t/o toggles with line-based scrolling', async () => {
    const statuses = [
      'running',
      'waiting',
      'passed',
      'failed',
      'skipped',
      'pending',
    ] as const
    for (const status of statuses) {
      const { lastFrame, unmount } = render(
        <LogViewerPane
          breadcrumb="demo › node"
          selectedNodeId="step:node"
          entries={[]}
          focused={false}
          width={60}
          height={8}
          status={status}
          activity={status === 'running'
            ? 'triage · thinking...'
            : undefined}
        />,
      )
      const frame = lastFrame()!
      const expectedGlyph = status === 'skipped' || status === 'pending'
        ? '○'
        : '●'
      expect(frame).toContain(expectedGlyph)
      if (status === 'running') {
        expect(frame).toContain('running · triage · thinking...')
      }
      if (status === 'waiting') {
        expect(frame).toContain('waiting for gate')
      }
      unmount()
    }

    const longOutput = Array.from({ length: 45 }, (_, i) => `out-${i + 1}`).join('\n')
    const entries: KeyedRunUiEntry[] = [
      {
        id: 0,
        kind: 'agent.thought',
        text: 'deep thought',
        streaming: false,
      },
      {
        id: 1,
        kind: 'guardrail.passed',
        name: 'lint',
        output: longOutput,
      },
    ]
    const { lastFrame, stdin, unmount } = render(
      <LogViewerPane
        breadcrumb="demo › lint"
        selectedNodeId="step:lint"
        entries={entries}
        focused={true}
        width={60}
        height={12}
        status="passed"
      />,
    )

    expect(lastFrame()).toContain('press \'o\' to expand')
    await new Promise(resolve => setTimeout(resolve, 20))
    stdin.write('g')
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(lastFrame()).toContain('deep thought')

    stdin.write('t')
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(lastFrame()).toContain('thoughts:off')
    expect(lastFrame()).not.toContain('deep thought')

    stdin.write('o')
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(lastFrame()).toContain('output:full')
    expect(lastFrame()).not.toContain('press \'o\' to expand')

    stdin.write('G')
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(lastFrame()).toContain('out-45')
    unmount()

    const labeled = render(<StatusCircle status="passed" showLabel />)
    expect(labeled.lastFrame()).toContain('● passed')
    labeled.unmount()
  })
})
