import { Box, Text } from 'ink'

export interface TaskHeaderProps {
  taskId: number | string
  taskName: string
}

export function TaskHeader({ taskId, taskName }: TaskHeaderProps) {
  return (
    <Box borderStyle="round" flexDirection="column" marginBottom={1} paddingX={1} width="100%">
      <Text bold color="cyan">
        {`Refining Task #${taskId}: ${taskName}`}
      </Text>
    </Box>
  )
}
