import type { RefineIntent } from '../../store/task-store.js'
import { TextInput } from '@inkjs/ui'
import { Box, Text } from 'ink'

export interface IntentConfirmationProps {
  intent: RefineIntent
  onConfirm: (val: string) => void | Promise<void>
}

const INTENT_FIELDS: Array<{ key: keyof RefineIntent, label: string }> = [
  { key: 'outcome', label: 'Outcome' },
  { key: 'user', label: 'User' },
  { key: 'whyNow', label: 'Why now' },
  { key: 'success', label: 'Success' },
  { key: 'constraint', label: 'Constraint' },
  { key: 'outOfScope', label: 'Out of scope' },
]

export function IntentConfirmation({ intent, onConfirm }: IntentConfirmationProps) {
  return (
    <Box flexDirection="column">
      <Text bold color="cyan">STATEMENT OF INTENT:</Text>
      {INTENT_FIELDS.map(({ key, label }) => (
        <Text key={key}>
          <Text bold color="cyan">{`${label}: `}</Text>
          {intent[key]}
        </Text>
      ))}
      <Box marginTop={1}>
        <Text>Confirm intent? (Enter/y to confirm, or type refinement feedback): </Text>
        <TextInput
          placeholder="y"
          onSubmit={(val) => {
            void onConfirm(val)
          }}
        />
      </Box>
    </Box>
  )
}
