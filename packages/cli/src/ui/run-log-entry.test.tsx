import type { RunUiEntry } from './run-ui-bridge.js'
import { render } from 'ink-testing-library'
import { expect, it } from 'vitest'
import { RunLogEntry } from './run-log-entry.js'

it('renders every RunUiEntry variant cleanly', () => {
  const cases: Array<[RunUiEntry, string]> = [
    [
      { kind: 'run.started', harnessName: 'demo' },
      '◆ demo',
    ],
    [
      { kind: 'run.resumed', harnessName: 'demo' },
      '◆ demo (resumed)',
    ],
    [
      { kind: 'run.resumed' },
      '◆ Run (resumed)',
    ],
    [
      { kind: 'run.passed' },
      '✔ Run passed',
    ],
    [
      { kind: 'run.failed', error: 'boom' },
      '✖ Run failed: boom',
    ],
    [
      { kind: 'run.failed' },
      '✖ Run failed',
    ],
    [
      { kind: 'step.started', stepId: 'build' },
      '▸ build',
    ],
    [
      { kind: 'step.passed', stepId: 'build' },
      '✔ build passed',
    ],
    [
      { kind: 'step.skipped', stepId: 'build' },
      '↷ build skipped',
    ],
    [
      { kind: 'step.failed', stepId: 'build', error: 'bad' },
      '✖ build failed: bad',
    ],
    [
      { kind: 'step.failed', stepId: 'build' },
      '✖ build failed',
    ],
    [
      { kind: 'step.retry', stepId: 'build', attempt: 2 },
      '↻ retrying (attempt 2)',
    ],
    [
      { kind: 'step.retry', stepId: 'build' },
      '↻ retrying',
    ],
    [
      { kind: 'guardrail.passed' },
      '✔ guardrail passed',
    ],
    [
      { kind: 'guardrail.passed', name: 'typecheck' },
      '✔ guardrail typecheck passed',
    ],
    [
      { kind: 'guardrail.skipped' },
      '↷ guardrail skipped',
    ],
    [
      { kind: 'guardrail.skipped', name: 'typecheck' },
      '↷ guardrail typecheck skipped',
    ],
    [
      { kind: 'guardrail.failed' },
      '✖ guardrail failed',
    ],
    [
      { kind: 'guardrail.failed', name: 'typecheck' },
      '✖ guardrail typecheck failed',
    ],
    [
      { kind: 'tool.start', toolName: 'read', argsSummary: 'path=a.ts' },
      '⚙ read  path=a.ts',
    ],
    [
      { kind: 'tool.start', toolName: 'list_artifacts' },
      '⚙ list_artifacts',
    ],
    [
      { kind: 'tool.error', toolName: 'bash' },
      '✖ bash failed',
    ],
    [
      { kind: 'agent.text', text: 'Working on it' },
      'Working on it',
    ],
    [
      { kind: 'agent.output', output: '{"guess":2}' },
      '↳ output  {"guess":2}',
    ],
    [
      { kind: 'prompt.answered', prompt: 'Max?', answer: '10' },
      '✔ Max? → 10',
    ],
  ]

  for (const [entry, expected] of cases) {
    const { lastFrame, unmount } = render(<RunLogEntry entry={entry} />)
    expect(lastFrame()).toContain(expected)
    unmount()
  }
})
