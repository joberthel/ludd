import type { ActiveTtyPrompt } from './interactive-question-prompt.js'
import process from 'node:process'
import { Spinner, StatusMessage } from '@inkjs/ui'
import { Box, Static, Text } from 'ink'
import { useEffect, useState } from 'react'
import { InteractiveQuestionPrompt, registerTtyPromptHost } from './interactive-question-prompt.js'

export interface CommandRunnerProps {
  /** Executes the underlying CLI action and resolves to an exit code. */
  execute: () => Promise<number>
  /** Optional spinner label shown while the command is executing. */
  spinnerLabel?: string
}

interface AnsweredPrompt {
  id: number
  prompt: string
  answer: string
}

function formatPromptAnswer(answer: unknown): string {
  if (typeof answer === 'boolean')
    return answer ? 'yes' : 'no'
  if (Array.isArray(answer))
    return answer.join(', ')
  return String(answer)
}

export function CommandRunner({ execute, spinnerLabel }: CommandRunnerProps) {
  const [status, setStatus] = useState<'running' | 'done' | 'error'>('running')
  const [errorMessage, setErrorMessage] = useState<string | undefined>()
  const [activePrompt, setActivePrompt] = useState<ActiveTtyPrompt | undefined>()
  const [history, setHistory] = useState<AnsweredPrompt[]>([])

  useEffect(() => registerTtyPromptHost(setActivePrompt), [])

  useEffect(() => {
    let active = true
    void execute()
      .then((code) => {
        if (!active)
          return
        process.exitCode = code
        setStatus('done')
      })
      .catch((error: unknown) => {
        if (!active)
          return
        const message = error instanceof Error
          ? error.message
          : String(error)
        process.exitCode = 1
        console.error(message)
        setErrorMessage(message)
        setStatus('error')
      })
    return () => {
      active = false
    }
  }, [execute])

  const handleSubmit = (answer: unknown): void => {
    const current = activePrompt!
    setHistory(prev => [
      ...prev,
      {
        id: prev.length,
        prompt: current.question.prompt,
        answer: formatPromptAnswer(answer),
      },
    ])
    current.onSubmit(answer)
  }

  return (
    <Box flexDirection="column">
      <Static items={history}>
        {item => (
          <Text key={item.id}>
            <Text color="green">✔ </Text>
            <Text bold>{item.prompt}</Text>
            <Text dimColor> → </Text>
            <Text>{item.answer}</Text>
          </Text>
        )}
      </Static>
      {activePrompt !== undefined
        ? (
            <InteractiveQuestionPrompt
              question={activePrompt.question}
              onSubmit={handleSubmit}
            />
          )
        : status === 'error' && errorMessage !== undefined
          ? <StatusMessage variant="error">{errorMessage}</StatusMessage>
          : status === 'running' && spinnerLabel !== undefined
            ? <Spinner label={spinnerLabel} />
            : null}
    </Box>
  )
}
