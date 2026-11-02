import { Box, Text } from 'ink'

export interface QuestionDetailsProps {
  hypothesis: string
  confidence: number
  missing?: string
  question: string
  guess: string
  answer?: string
}

export function QuestionDetails({
  hypothesis,
  confidence,
  missing,
  question,
  guess,
  answer,
}: QuestionDetailsProps) {
  const hasMissing = missing !== undefined && missing !== ''

  return (
    <Box flexDirection="column">
      <Text>
        <Text bold color="cyan">HYPOTHESIS: </Text>
        {hypothesis}
      </Text>
      <Text>
        <Text bold color="cyan">CONFIDENCE: </Text>
        {`${confidence}%`}
      </Text>
      {hasMissing
        ? (
            <Text>
              <Text bold color="cyan">MISSING: </Text>
              {missing}
            </Text>
          )
        : null}
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
