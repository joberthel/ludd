import { Box, Text } from 'ink'

export interface QuestionDetailsProps {
  question: string
  guess: string
  answer?: string
}

export function QuestionDetails({
  question,
  guess,
  answer,
}: QuestionDetailsProps) {
  return (
    <Box flexDirection="column">
      <Text>
        <Text bold color="cyan">Q: </Text>
        {question}
      </Text>
      <Text>
        <Text bold color="cyan">GUESS: </Text>
        {guess}
      </Text>
      {answer !== undefined
        ? (
            <Text>
              <Text bold color="green">ANSWER: </Text>
              <Text bold>{answer}</Text>
            </Text>
          )
        : null}
    </Box>
  )
}
