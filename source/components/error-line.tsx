import { Box, Text } from 'ink'

export function toMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message
  }
  return String(err)
}

interface ErrorLineProps {
  message: string
}

export function ErrorLine({ message }: ErrorLineProps) {
  return (
    <Box>
      <Text>
        <Text color="red">[ERROR]</Text>
        {' '}
        {message}
      </Text>
    </Box>
  )
}
