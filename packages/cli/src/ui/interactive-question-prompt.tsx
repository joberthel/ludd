import type { InteractiveQuestion } from '@ludd/core'
import { ConfirmInput, MultiSelect, Select, StatusMessage, TextInput } from '@inkjs/ui'
import { normalizeSelectOptions, validateInteractiveAnswer } from '@ludd/core'
import { Box, render, Text } from 'ink'
import { useState } from 'react'

export interface InteractiveQuestionPromptProps {
  question: InteractiveQuestion
  onSubmit: (answer: unknown) => void
}

export interface ActiveTtyPrompt {
  question: InteractiveQuestion
  onSubmit: (answer: unknown) => void
}

type TtyPromptHost = (prompt: ActiveTtyPrompt | undefined) => void
let activePromptHost: TtyPromptHost | undefined

export function registerTtyPromptHost(host: TtyPromptHost): () => void {
  activePromptHost = host
  return () => {
    if (activePromptHost === host) {
      activePromptHost = undefined
    }
  }
}

function renderControl(
  question: InteractiveQuestion,
  onSubmit: (answer: unknown) => void,
  onError: (message: string | undefined) => void,
) {
  if (question.type === 'text') {
    return (
      <TextInput
        defaultValue={question.default}
        placeholder={question.placeholder}
        onSubmit={value => onSubmit(value)}
      />
    )
  }
  if (question.type === 'number') {
    return (
      <TextInput
        defaultValue={question.default !== undefined
          ? String(question.default)
          : undefined}
        onSubmit={(raw) => {
          try {
            const parsed = validateInteractiveAnswer(question, raw)
            onError(undefined)
            onSubmit(parsed)
          }
          catch (err: unknown) {
            onError((err as Error).message)
          }
        }}
      />
    )
  }
  if (question.type === 'confirm') {
    return (
      <ConfirmInput
        defaultChoice={question.default === false
          ? 'cancel'
          : 'confirm'}
        onConfirm={() => onSubmit(true)}
        onCancel={() => onSubmit(false)}
      />
    )
  }
  const options = normalizeSelectOptions(question.options)
  if (question.type === 'select') {
    const ordered = question.default !== undefined
      ? [
          ...options.filter(opt => opt.value === question.default),
          ...options.filter(opt => opt.value !== question.default),
        ]
      : options
    return (
      <Select
        options={ordered}
        onChange={value => onSubmit(value)}
      />
    )
  }
  return (
    <MultiSelect
      options={options}
      defaultValue={question.default !== undefined
        ? [...question.default]
        : undefined}
      onSubmit={values => onSubmit(values)}
    />
  )
}

export function InteractiveQuestionPrompt({ question, onSubmit }: InteractiveQuestionPromptProps) {
  const [error, setError] = useState<string | undefined>()

  return (
    <Box flexDirection="column" marginY={1}>
      <Text bold color="cyan">{question.prompt}</Text>
      {renderControl(question, onSubmit, setError)}
      {error !== undefined
        ? <StatusMessage variant="error">{error}</StatusMessage>
        : null}
    </Box>
  )
}

export async function promptInteractiveQuestionInTty(
  question: InteractiveQuestion,
  signal?: AbortSignal,
  renderImpl?: (element: ReturnType<typeof InteractiveQuestionPrompt>) => { unmount: () => void },
): Promise<unknown> {
  return new Promise<unknown>((resolve, reject) => {
    const abortError = (): Error => {
      const err = new Error('Interactive prompt aborted')
      err.name = 'AbortError'
      return err
    }
    if (signal?.aborted) {
      reject(abortError())
      return
    }
    let instance: { unmount: () => void } | undefined
    const host = renderImpl === undefined
      ? activePromptHost
      : undefined
    const cleanup = (): void => {
      signal?.removeEventListener('abort', onAbort)
      host?.(undefined)
      instance?.unmount()
    }
    function onAbort(): void {
      cleanup()
      reject(abortError())
    }
    const handleSubmit = (answer: unknown): void => {
      cleanup()
      resolve(answer)
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    if (host !== undefined) {
      host({ question, onSubmit: handleSubmit })
      return
    }
    const mount = renderImpl ?? (element => render(element, { patchConsole: false }))
    instance = mount(
      <InteractiveQuestionPrompt
        question={question}
        onSubmit={handleSubmit}
      />,
    )
  })
}
