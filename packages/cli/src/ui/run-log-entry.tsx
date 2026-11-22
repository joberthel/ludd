import type { RunUiEntry } from './run-ui-bridge.js'
import { Box, Text } from 'ink'

export interface RunLogEntryProps {
  entry: RunUiEntry
}

export function RunLogEntry({ entry }: RunLogEntryProps) {
  switch (entry.kind) {
    case 'run.started':
      return (
        <Box marginBottom={1}>
          <Text bold color="cyan">
            ◆
            {' '}
            {entry.harnessName}
          </Text>
        </Box>
      )
    case 'run.resumed':
      return (
        <Box marginBottom={1}>
          <Text bold color="cyan">
            ◆
            {' '}
            {entry.harnessName ?? 'Run'}
          </Text>
          <Text dimColor> (resumed)</Text>
        </Box>
      )
    case 'run.passed':
      return (
        <Box marginTop={1}>
          <Text bold color="green">✔ Run passed</Text>
        </Box>
      )
    case 'run.failed':
      return (
        <Box marginTop={1}>
          <Text bold color="red">
            ✖ Run failed
            {entry.error !== undefined
              ? `: ${entry.error}`
              : ''}
          </Text>
        </Box>
      )
    case 'step.started':
      return (
        <Text bold>
          ▸
          {' '}
          {entry.stepId}
        </Text>
      )
    case 'step.passed':
      return (
        <Text color="green">
          ✔
          {' '}
          {entry.stepId}
          {' '}
          passed
        </Text>
      )
    case 'step.skipped':
      return (
        <Text dimColor>
          ↷
          {' '}
          {entry.stepId}
          {' '}
          skipped
        </Text>
      )
    case 'step.failed':
      return (
        <Text color="red">
          ✖
          {' '}
          {entry.stepId}
          {' '}
          failed
          {entry.error !== undefined
            ? `: ${entry.error}`
            : ''}
        </Text>
      )
    case 'step.retry':
      return (
        <Text color="yellow">
          {'  '}
          ↻ retrying
          {entry.attempt !== undefined
            ? ` (attempt ${entry.attempt})`
            : ''}
        </Text>
      )
    case 'guardrail.started':
      return (
        <Text color="cyan">
          {`  ● guardrail${entry.name !== undefined
            ? ` ${entry.name}`
            : ''} running…`}
        </Text>
      )
    case 'guardrail.passed':
    case 'guardrail.skipped':
    case 'guardrail.failed': {
      const color = entry.kind === 'guardrail.passed'
        ? 'green'
        : entry.kind === 'guardrail.failed'
          ? 'red'
          : undefined
      const icon = entry.kind === 'guardrail.passed'
        ? '✔'
        : entry.kind === 'guardrail.skipped'
          ? '↷'
          : '✖'
      const verb = entry.kind === 'guardrail.passed'
        ? 'passed'
        : entry.kind === 'guardrail.skipped'
          ? 'skipped'
          : 'failed'
      const hasExtra = (entry.output !== undefined && entry.output !== '') || (entry.logKey !== undefined && entry.logKey !== '')
      const header = (
        <Text color={color} dimColor={entry.kind === 'guardrail.skipped'}>
          {`  ${icon} guardrail${entry.name !== undefined
            ? ` ${entry.name}`
            : ''} ${verb}`}
        </Text>
      )
      if (!hasExtra) {
        return header
      }
      return (
        <Box flexDirection="column">
          {header}
          {entry.output !== undefined && entry.output !== ''
            ? entry.output.split(/\r?\n/).map((line, idx) => (
                <Text key={idx} dimColor>
                  {'    │ '}
                  {line}
                </Text>
              ))
            : null}
          {entry.logKey !== undefined && entry.logKey !== ''
            ? (
                <Text dimColor>
                  {'    logKey: '}
                  {entry.logKey}
                </Text>
              )
            : null}
        </Box>
      )
    }
    case 'tool.start':
      return (
        <Text dimColor>
          {'  ⚙ '}
          {entry.toolName}
          {entry.argsSummary !== undefined
            ? `  ${entry.argsSummary}`
            : ''}
        </Text>
      )
    case 'tool.error':
      return (
        <Text color="red">
          {'  ✖ '}
          {entry.toolName}
          {' '}
          failed
        </Text>
      )
    case 'agent.thought':
      return (
        <Box flexDirection="column">
          <Text dimColor italic>
            {entry.streaming === true
              ? '  💭 thinking…'
              : '  💭 thought'}
          </Text>
          {entry.text.split(/\r?\n/).map((line, idx) => (
            <Text key={idx} dimColor italic>
              {'  │ '}
              {line}
            </Text>
          ))}
        </Box>
      )
    case 'agent.text':
      return (
        <Text>
          {'  '}
          {entry.text}
        </Text>
      )
    case 'agent.output':
      return (
        <Text>
          {'  '}
          <Text color="cyan">↳ output</Text>
          {'  '}
          {entry.output}
        </Text>
      )
    case 'prompt.answered':
      return (
        <Text>
          {'  '}
          <Text color="green">✔ </Text>
          <Text bold>{entry.prompt}</Text>
          <Text dimColor> → </Text>
          <Text>{entry.answer}</Text>
        </Text>
      )
  }
}
