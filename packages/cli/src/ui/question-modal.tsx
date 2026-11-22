import type { ActiveTtyPrompt } from './interactive-question-prompt.js'
import { Box, Text } from 'ink'
import { InteractiveQuestionPrompt } from './interactive-question-prompt.js'

export interface QuestionModalProps {
  prompt: ActiveTtyPrompt
  contextLabel?: string
  minimized: boolean
  width?: number
  onSubmit: (answer: unknown) => void
}

export function QuestionModal({
  prompt,
  contextLabel,
  minimized,
  width,
  onSubmit,
}: QuestionModalProps) {
  const modalWidth = width !== undefined
    ? Math.max(40, Math.min(76, width - 6))
    : 64

  return (
    <Box
      display={minimized ? 'none' : 'flex'}
      position="absolute"
      width="100%"
      height="100%"
      alignItems="center"
      justifyContent="center"
    >
      <Box
        flexDirection="column"
        width={modalWidth}
        borderStyle="double"
        borderColor="yellow"
        // Non-color truthy value triggers Ink's opaque space fill without emitting a background ANSI code,
        // so the modal occludes underlying content while using the terminal's default background color.
        backgroundColor="default"
        paddingX={2}
        paddingY={1}
      >
        <Box justifyContent="space-between">
          <Text bold color="yellow">⏸ Input Required</Text>
          {contextLabel !== undefined && contextLabel !== ''
            ? <Text dimColor>{contextLabel}</Text>
            : null}
        </Box>
        <InteractiveQuestionPrompt
          question={prompt.question}
          isDisabled={minimized}
          onSubmit={onSubmit}
        />
        <Text dimColor>Press Ctrl+B to minimize and inspect logs</Text>
      </Box>
    </Box>
  )
}
