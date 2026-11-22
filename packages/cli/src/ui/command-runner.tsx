import type { ActiveTtyPrompt } from './interactive-question-prompt.js'
import type { RunUiEntry } from './run-ui-bridge.js'
import process from 'node:process'
import { Spinner, StatusMessage } from '@inkjs/ui'
import { Box, Static } from 'ink'
import { useEffect, useState } from 'react'
import { InteractiveQuestionPrompt, registerTtyPromptHost } from './interactive-question-prompt.js'
import { RunLogEntry } from './run-log-entry.js'
import { registerRunUiHost } from './run-ui-bridge.js'

export interface CommandRunnerProps {
  /** Executes the underlying CLI action and resolves to an exit code. */
  execute: () => Promise<number>
  /** Optional spinner label shown while the command is executing. */
  spinnerLabel?: string
}

type KeyedRunUiEntry = RunUiEntry & { id: number }

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
  const [activity, setActivity] = useState<string | undefined>()
  const [entries, setEntries] = useState<KeyedRunUiEntry[]>([])

  useEffect(() => registerTtyPromptHost(setActivePrompt), [])

  useEffect(() => {
    if (!process.stdout.isTTY) {
      return undefined
    }
    return registerRunUiHost({
      pushEntry: (entry) => {
        setEntries(prev => [
          ...prev,
          { ...entry, id: prev.length },
        ])
      },
      setActivity,
    })
  }, [])

  useEffect(() => {
    let active = true
    void execute()
      .then((code) => {
        if (!active)
          return
        process.exitCode = code
        setActivity(undefined)
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
        setActivity(undefined)
        setErrorMessage(message)
        setStatus('error')
      })
    return () => {
      active = false
    }
  }, [execute])

  const handleSubmit = (answer: unknown): void => {
    const current = activePrompt!
    setEntries(prev => [
      ...prev,
      {
        id: prev.length,
        kind: 'prompt.answered',
        prompt: current.question.prompt,
        answer: formatPromptAnswer(answer),
      },
    ])
    current.onSubmit(answer)
  }

  const activeSpinnerLabel = activity ?? spinnerLabel

  return (
    <Box flexDirection="column">
      <Static items={entries}>
        {item => <RunLogEntry key={item.id} entry={item} />}
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
          : status === 'running' && activeSpinnerLabel !== undefined
            ? <Spinner label={activeSpinnerLabel} />
            : null}
    </Box>
  )
}
