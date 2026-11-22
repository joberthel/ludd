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
    case 'guardrail.passed':
      return <Text color="green">{'  ✔ guardrail passed'}</Text>
    case 'guardrail.failed':
      return <Text color="red">{'  ✖ guardrail failed'}</Text>
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
