import { Text } from 'ink'

export const EMPTY_PLACEHOLDER = '(none)'

interface Props {
  value?: string
}

export function OptionalText({ value }: Props) {
  if (value !== undefined && value !== '') {
    return <Text>{value}</Text>
  }
  return <Text dimColor>{EMPTY_PLACEHOLDER}</Text>
}
