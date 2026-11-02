import type { Key } from 'ink'
import { Box, Text, useInput } from 'ink'
import { useState } from 'react'
import { QuestionDetails } from './question-details.js'

export interface QnATurn {
  hypothesis: string
  confidence: number
  missing?: string
  question: string
  guess: string
  answer: string
}

export interface QuestionHistoryProps {
  history: QnATurn[]
  selectedIndex?: number | null
  onSelectIndex?: (index: number | null) => void
  isActive?: boolean
}

export function QuestionHistory({
  history,
  selectedIndex: controlledIndex,
  onSelectIndex,
  isActive = true,
}: QuestionHistoryProps) {
  const [internalIndex, setInternalIndex] = useState<number | null>(null)
  const isControlled = controlledIndex !== undefined
  const selectedIndex = isControlled ? controlledIndex : internalIndex

  const updateIndex = (nextIndex: number | null) => {
    if (!isControlled) {
      setInternalIndex(nextIndex)
    }
    onSelectIndex?.(nextIndex)
  }

  useInput(
    (_input: string, key: Key) => {
      if (history.length === 0) {
        return
      }

      if (key.pageUp) {
        if (selectedIndex === null) {
          updateIndex(history.length - 1)
        }
        else if (selectedIndex > 0) {
          updateIndex(selectedIndex - 1)
        }
      }
      else if (key.pageDown) {
        if (selectedIndex !== null) {
          if (selectedIndex < history.length - 1) {
            updateIndex(selectedIndex + 1)
          }
          else {
            updateIndex(null)
          }
        }
      }
      else if (key.escape && selectedIndex !== null) {
        updateIndex(null)
      }
    },
    { isActive },
  )

  if (history.length === 0) {
    return null
  }

  if (selectedIndex === null) {
    return (
      <Box marginBottom={1}>
        <Text dimColor>
          {`[History: ${history.length} past turn(s) - press PageUp to view]`}
        </Text>
      </Box>
    )
  }

  const turn = history[selectedIndex]
  if (turn === undefined) {
    return null
  }

  return (
    <Box borderStyle="single" flexDirection="column" marginBottom={1} paddingX={1} width="100%">
      <Box justifyContent="space-between" width="100%">
        <Text bold color="yellow">
          {`[History ${selectedIndex + 1}/${history.length} - PageUp/PageDown]`}
        </Text>
        <Text dimColor>
          {selectedIndex === history.length - 1
            ? '(PageDown returns to active prompt)'
            : '(PageDown for newer)'}
        </Text>
      </Box>

      <Box marginTop={1}>
        <QuestionDetails
          answer={turn.answer}
          confidence={turn.confidence}
          guess={turn.guess}
          hypothesis={turn.hypothesis}
          missing={turn.missing}
          question={turn.question}
        />
      </Box>
    </Box>
  )
}
