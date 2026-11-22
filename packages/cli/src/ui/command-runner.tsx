import type { ActiveTtyPrompt } from './interactive-question-prompt.js'
import type { RunTreeState } from './run-tree-state.js'
import type { RunUiEntry } from './run-ui-bridge.js'
import process from 'node:process'
import { Spinner, StatusMessage } from '@inkjs/ui'
import { Box, Static, Text } from 'ink'
import { useEffect, useReducer, useState } from 'react'
import { InteractiveQuestionPrompt, registerTtyPromptHost } from './interactive-question-prompt.js'
import { RunDashboard } from './run-dashboard.js'
import { RunLogEntry } from './run-log-entry.js'
import { createInitialRunTreeState, runTreeReducer } from './run-tree-state.js'
import { registerRunUiHost } from './run-ui-bridge.js'

export interface CommandRunnerProps {
  /** Executes the underlying CLI action and resolves to an exit code. */
  execute: () => Promise<number>
  /** Optional spinner label shown while the command is executing. */
  spinnerLabel?: string
  /** Enable full-screen split-pane dashboard when running in a TTY. */
  dashboard?: boolean
}

type KeyedRunUiEntry = RunUiEntry & { id: number }

function formatPromptAnswer(answer: unknown): string {
  if (typeof answer === 'boolean')
    return answer ? 'yes' : 'no'
  if (Array.isArray(answer))
    return answer.join(', ')
  return String(answer)
}

function FinalRunSummary({
  state,
  status,
  errorMessage,
}: {
  state: RunTreeState
  status: 'done' | 'error'
  errorMessage?: string
}) {
  const passed = status === 'done' && state.runStatus !== 'failed'
  return (
    <Box flexDirection="column">
      <Text bold color={passed ? 'green' : 'red'}>
        {passed ? '✔' : '✖'}
        {' '}
        {state.harnessName}
        {' — '}
        {passed
          ? 'Run passed'
          : `Run failed${errorMessage !== undefined
            ? `: ${errorMessage}`
            : ''}`}
      </Text>
      {state.steps.map(step => (
        <Text key={step.id} dimColor={step.status === 'skipped' || step.status === 'pending'}>
          {'  '}
          {step.status === 'passed'
            ? '✔'
            : step.status === 'failed'
              ? '✖'
              : step.status === 'skipped'
                ? '↷'
                : '○'}
          {' '}
          {step.name ?? step.id}
          {' '}
          (
          {step.status}
          )
        </Text>
      ))}
    </Box>
  )
}

export function CommandRunner({ execute, spinnerLabel, dashboard = false }: CommandRunnerProps) {
  const isDashboard = Boolean(dashboard && process.stdout.isTTY)
  const [status, setStatus] = useState<'running' | 'done' | 'error'>('running')
  const [errorMessage, setErrorMessage] = useState<string | undefined>()
  const [activePrompt, setActivePrompt] = useState<ActiveTtyPrompt | undefined>()
  const [activity, setActivity] = useState<string | undefined>()
  const [entries, setEntries] = useState<KeyedRunUiEntry[]>([])
  const [treeState, dispatch] = useReducer(runTreeReducer, undefined, () => createInitialRunTreeState())

  useEffect(() => registerTtyPromptHost(setActivePrompt), [])

  useEffect(() => {
    if (!process.stdout.isTTY) {
      return undefined
    }
    if (isDashboard) {
      return registerRunUiHost({
        pushEntry: entry => dispatch({ type: 'PUSH_ENTRY', entry }),
        upsertEntry: (streamKey, entry) => dispatch({ type: 'UPSERT_ENTRY', streamKey, entry }),
        setActivity: label => dispatch({ type: 'SET_ACTIVITY', activity: label }),
        setBlueprint: blueprint => dispatch({ type: 'SET_BLUEPRINT', blueprint }),
        hydrateSnapshot: snapshot => dispatch({ type: 'HYDRATE_SNAPSHOT', snapshot }),
        onGuardrailStarted: scope => dispatch({ type: 'GUARDRAIL_STARTED', scope }),
        setGateWaiting: (waiting, scope) => dispatch({ type: 'SET_GATE_WAITING', waiting, scope }),
      })
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
  }, [isDashboard])

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
    const answeredEntry: RunUiEntry = {
      kind: 'prompt.answered',
      prompt: current.question.prompt,
      answer: formatPromptAnswer(answer),
    }
    if (isDashboard) {
      dispatch({ type: 'PUSH_ENTRY', entry: answeredEntry })
    }
    else {
      setEntries(prev => [
        ...prev,
        {
          ...answeredEntry,
          id: prev.length,
        },
      ])
    }
    current.onSubmit(answer)
  }

  if (isDashboard) {
    if (status === 'done' || status === 'error') {
      return (
        <FinalRunSummary
          state={treeState}
          status={status}
          errorMessage={errorMessage}
        />
      )
    }
    return (
      <RunDashboard
        state={treeState}
        dispatch={dispatch}
        activePrompt={activePrompt}
        status={status}
        errorMessage={errorMessage}
        onPromptSubmit={handleSubmit}
      />
    )
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
