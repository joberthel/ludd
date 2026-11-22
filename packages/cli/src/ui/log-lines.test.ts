import type { KeyedRunUiEntry } from './run-tree-state.js'
import { describe, expect, it } from 'vitest'
import { buildRenderedLogLines } from './log-lines.js'

describe('buildRenderedLogLines', () => {
  it('preserves 1-to-1 line mapping for short single-line entries', () => {
    const entries: KeyedRunUiEntry[] = [
      { id: 0, kind: 'run.started', harnessName: 'demo' },
      { id: 1, kind: 'step.started', stepId: 'triage' },
      { id: 2, kind: 'agent.text', text: 'short line' },
      {
        id: 3,
        kind: 'tool.start',
        toolName: 'read',
        argsSummary: 'path=a.ts',
      },
      { id: 4, kind: 'step.passed', stepId: 'triage' },
      { id: 5, kind: 'run.passed' },
    ]

    const lines = buildRenderedLogLines(entries, {
      width: 80,
      showThoughts: true,
      expandOutput: false,
    })

    expect(lines).toHaveLength(6)
    expect(lines.map(l => l.text)).toEqual([
      '◆ demo',
      '▸ triage',
      '  short line',
      '  ⚙ read  path=a.ts',
      '✔ triage passed',
      '✔ Run passed',
    ])
  })

  it('wraps long lines to pane width', () => {
    const entries: KeyedRunUiEntry[] = [
      { id: 0, kind: 'agent.text', text: 'abcdefghij1234567890' },
    ]
    const lines = buildRenderedLogLines(entries, {
      width: 12,
      showThoughts: true,
      expandOutput: false,
    })
    expect(lines.length).toBeGreaterThan(1)
    for (const line of lines) {
      expect(line.text.length).toBeLessThanOrEqual(12)
      expect(line.text.startsWith('  ')).toBe(true)
    }
  })

  it('renders agent.thought blocks with rail prefix and hides them when showThoughts is false', () => {
    const entries: KeyedRunUiEntry[] = [
      {
        id: 0,
        kind: 'agent.thought',
        text: 'line one\nline two',
        streaming: true,
      },
      {
        id: 1,
        kind: 'agent.thought',
        text: 'final thought',
        streaming: false,
      },
      { id: 2, kind: 'agent.text', text: 'visible answer' },
    ]

    const shown = buildRenderedLogLines(entries, {
      width: 80,
      showThoughts: true,
      expandOutput: false,
    })
    expect(shown.map(l => l.text)).toEqual([
      '  💭 thinking…',
      '  │ line one',
      '  │ line two',
      '  💭 thought',
      '  │ final thought',
      '  visible answer',
    ])
    expect(shown[0].italic).toBe(true)
    expect(shown[0].dimColor).toBe(true)

    const hidden = buildRenderedLogLines(entries, {
      width: 80,
      showThoughts: false,
      expandOutput: false,
    })
    expect(hidden.map(l => l.text)).toEqual(['  visible answer'])
  })

  it('renders guardrail.started and multi-line guardrail output with truncation and full expansion', () => {
    const longOutput = Array.from({ length: 5 }, (_, i) => `out-${i + 1}`).join('\n')
    const entries: KeyedRunUiEntry[] = [
      { id: 0, kind: 'guardrail.started', name: 'lint' },
      {
        id: 1,
        kind: 'guardrail.passed',
        name: 'lint',
        output: longOutput,
        logKey: 'lint-0',
      },
    ]

    const collapsed = buildRenderedLogLines(entries, {
      width: 80,
      showThoughts: true,
      expandOutput: false,
      maxOutputLines: 3,
    })
    expect(collapsed.map(l => l.text)).toEqual([
      '  ● guardrail lint running…',
      '  ✔ guardrail lint passed',
      '    │ out-1',
      '    │ out-2',
      '    │ out-3',
      '    … (2 more lines — press \'o\' to expand)',
      '    logKey: lint-0',
    ])

    const expanded = buildRenderedLogLines(entries, {
      width: 80,
      showThoughts: true,
      expandOutput: true,
      maxOutputLines: 3,
    })
    expect(expanded.map(l => l.text)).toEqual([
      '  ● guardrail lint running…',
      '  ✔ guardrail lint passed',
      '    │ out-1',
      '    │ out-2',
      '    │ out-3',
      '    │ out-4',
      '    │ out-5',
      '    logKey: lint-0',
    ])
  })

  it('covers all remaining entry variants and singular truncation', () => {
    const entries: KeyedRunUiEntry[] = [
      { id: 0, kind: 'run.resumed', harnessName: 'demo' },
      { id: 1, kind: 'run.resumed' },
      { id: 2, kind: 'run.failed', error: 'boom' },
      { id: 3, kind: 'run.failed' },
      { id: 4, kind: 'step.skipped', stepId: 's1' },
      {
        id: 5,
        kind: 'step.failed',
        stepId: 's2',
        error: 'bad',
      },
      { id: 6, kind: 'step.failed', stepId: 's2' },
      {
        id: 7,
        kind: 'step.retry',
        stepId: 's2',
        attempt: 2,
      },
      { id: 8, kind: 'step.retry', stepId: 's2' },
      { id: 9, kind: 'guardrail.started' },
      { id: 10, kind: 'guardrail.skipped' },
      { id: 11, kind: 'guardrail.failed', output: 'line1\nline2' },
      { id: 12, kind: 'tool.start', toolName: 'ls' },
      { id: 13, kind: 'tool.error', toolName: 'bash' },
      { id: 14, kind: 'agent.output', output: '{"ok":true}' },
      {
        id: 15,
        kind: 'prompt.answered',
        prompt: 'Go?',
        answer: 'yes',
      },
    ]

    const lines = buildRenderedLogLines(entries, {
      width: 80,
      showThoughts: true,
      expandOutput: false,
      maxOutputLines: 1,
    })

    expect(lines.map(l => l.text)).toEqual([
      '◆ demo (resumed)',
      '◆ Run (resumed)',
      '✖ Run failed: boom',
      '✖ Run failed',
      '↷ s1 skipped',
      '✖ s2 failed: bad',
      '✖ s2 failed',
      '  ↻ retrying (attempt 2)',
      '  ↻ retrying',
      '  ● guardrail running…',
      '  ↷ guardrail skipped',
      '  ✖ guardrail failed',
      '    │ line1',
      '    … (1 more line — press \'o\' to expand)',
      '  ⚙ ls',
      '  ✖ bash failed',
      '  ↳ output  {"ok":true}',
      '  ✔ Go? → yes',
    ])
  })
})
