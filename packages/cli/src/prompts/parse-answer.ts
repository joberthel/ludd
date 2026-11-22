import type { InteractiveQuestion } from '@ludd/core'
import { validateInteractiveAnswer } from '@ludd/core'

function parseBooleanInput(raw: string, fallback?: boolean): boolean {
  const normalized = raw.trim().toLowerCase()
  if (normalized === '' && fallback !== undefined) {
    return fallback
  }
  if (['y', 'yes', 'true', '1'].includes(normalized)) {
    return true
  }
  if (['n', 'no', 'false', '0'].includes(normalized)) {
    return false
  }
  throw new Error('Expected yes/no (true/false).')
}

function parseMultiSelectInput(raw: string, fallback?: readonly string[]): unknown {
  const trimmed = raw.trim()
  if (trimmed === '' && fallback !== undefined) {
    return [...fallback]
  }
  if (trimmed.startsWith('[')) {
    return JSON.parse(trimmed) as unknown
  }
  return trimmed === ''
    ? []
    : trimmed.split(',').map(part => part.trim()).filter(Boolean)
}

export function parseStringAnswer(question: InteractiveQuestion, raw: string): unknown {
  if (question.type === 'text') {
    const value = raw === '' && question.default !== undefined
      ? question.default
      : raw
    return validateInteractiveAnswer(question, value)
  }
  if (question.type === 'number') {
    const candidate = raw.trim() === '' && question.default !== undefined
      ? question.default
      : raw
    return validateInteractiveAnswer(question, candidate)
  }
  if (question.type === 'confirm') {
    return validateInteractiveAnswer(question, parseBooleanInput(raw, question.default))
  }
  if (question.type === 'select') {
    const candidate = raw.trim() === '' && question.default !== undefined
      ? question.default
      : raw.trim()
    return validateInteractiveAnswer(question, candidate)
  }
  return validateInteractiveAnswer(question, parseMultiSelectInput(raw, question.default))
}
