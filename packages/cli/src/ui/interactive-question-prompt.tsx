import type { InteractiveQuestion } from '@ludd/core'
import { ConfirmInput, MultiSelect, Select, StatusMessage } from '@inkjs/ui'
import { normalizeSelectOptions, validateInteractiveAnswer } from '@ludd/core'
import { Box, render, Text, useInput } from 'ink'
import { useState } from 'react'

export interface InteractiveQuestionPromptProps {
  question: InteractiveQuestion
  isDisabled?: boolean
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

interface PromptTextInputProps {
  defaultValue?: string
  placeholder?: string
  isDisabled?: boolean
  onSubmit: (value: string) => void
}

function PromptTextInput({
  defaultValue,
  placeholder,
  isDisabled = false,
  onSubmit,
}: PromptTextInputProps) {
  const initialValue = defaultValue ?? ''
  const [state, setState] = useState<{ value: string, cursorOffset: number }>(() => ({
    value: initialValue,
    cursorOffset: initialValue.length,
  }))

  useInput((input, key) => {
    if (
      key.ctrl
      || key.meta
      || key.upArrow
      || key.downArrow
      || key.tab
    ) {
      return
    }

    if (key.return) {
      onSubmit(state.value)
      return
    }

    if (key.leftArrow) {
      setState(prev => ({
        ...prev,
        cursorOffset: Math.max(0, prev.cursorOffset - 1),
      }))
      return
    }

    if (key.rightArrow) {
      setState(prev => ({
        ...prev,
        cursorOffset: Math.min(prev.value.length, prev.cursorOffset + 1),
      }))
      return
    }

    if (key.backspace || key.delete) {
      setState((prev) => {
        if (prev.cursorOffset === 0) {
          return prev
        }
        return {
          value: prev.value.slice(0, prev.cursorOffset - 1) + prev.value.slice(prev.cursorOffset),
          cursorOffset: prev.cursorOffset - 1,
        }
      })
      return
    }

    if (input.length > 0) {
      setState(prev => ({
        value: prev.value.slice(0, prev.cursorOffset) + input + prev.value.slice(prev.cursorOffset),
        cursorOffset: prev.cursorOffset + input.length,
      }))
    }
  }, { isActive: !isDisabled })

  const { value, cursorOffset } = state

  if (value.length === 0) {
    if (isDisabled) {
      return placeholder !== undefined && placeholder.length > 0
        ? <Text dimColor>{placeholder}</Text>
        : <Text> </Text>
    }
    if (placeholder !== undefined && placeholder.length > 0) {
      return (
        <Text>
          <Text inverse>{placeholder[0]}</Text>
          <Text dimColor>{placeholder.slice(1)}</Text>
        </Text>
      )
    }
    return <Text inverse> </Text>
  }

  if (isDisabled) {
    return <Text>{value}</Text>
  }

  const before = value.slice(0, cursorOffset)
  const cursorChar = value[cursorOffset] ?? ' '
  const after = value.slice(cursorOffset + 1)

  return (
    <Text>
      {before}
      <Text inverse>{cursorChar}</Text>
      {after}
    </Text>
  )
}

function renderControl(
  question: InteractiveQuestion,
  isDisabled: boolean,
  onSubmit: (answer: unknown) => void,
  onError: (message: string | undefined) => void,
) {
  if (question.type === 'text') {
    return (
      <PromptTextInput
        defaultValue={question.default}
        placeholder={question.placeholder}
        isDisabled={isDisabled}
        onSubmit={value => onSubmit(value)}
      />
    )
  }
  if (question.type === 'number') {
    return (
      <PromptTextInput
        defaultValue={question.default !== undefined
          ? String(question.default)
          : undefined}
        isDisabled={isDisabled}
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
        isDisabled={isDisabled}
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
        isDisabled={isDisabled}
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
      isDisabled={isDisabled}
      onSubmit={values => onSubmit(values)}
    />
  )
}

export function InteractiveQuestionPrompt({
  question,
  isDisabled = false,
  onSubmit,
}: InteractiveQuestionPromptProps) {
  const [error, setError] = useState<string | undefined>()

  return (
    <Box flexDirection="column" marginY={1}>
      <Text bold color="cyan">{question.prompt}</Text>
      {renderControl(question, isDisabled, onSubmit, setError)}
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
