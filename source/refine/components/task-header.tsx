import { Box, Text } from 'ink'

export interface TaskHeaderProps {
  taskId: number | string
  taskName: string
  model: string
}

export function TaskHeader({ taskId, taskName, model }: TaskHeaderProps) {
  return (
    <Box borderStyle="round" flexDirection="column" marginBottom={1} paddingX={1} width="100%">
      <Text bold color="cyan">
        {`Refining Task #${taskId}: ${taskName}`}
      </Text>
      <Text dimColor>
        {`Model: ${model}`}
      </Text>
    </Box>
  )
}
