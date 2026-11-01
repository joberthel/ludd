import type { ConfigSchema } from '../../store/config-store.js'
import type { Store } from '../../store/create-store.js'
import process from 'node:process'
import { Box, Text } from 'ink'
import React, { useEffect, useState } from 'react'
import zod from 'zod'
import { configStore, readConfigKey } from '../../store/config-store.js'

export const args = zod.tuple([
  zod.string().optional().describe('Optional dot-notated configuration key (e.g. dummyObject.nestedString)'),
])

interface Props {
  args: zod.infer<typeof args>
  store?: Store<typeof ConfigSchema>
}

interface ReadState {
  loading: boolean
  error?: string
  value?: unknown
}

export default function ConfigRead({ args: [key], store = configStore }: Props) {
  const [state, setState] = useState<ReadState>({ loading: true })

  useEffect(() => {
    let isMounted = true

    readConfigKey(store, key)
      .then((val) => {
        if (isMounted) {
          setState({ loading: false, value: val })
        }
      })
      .catch((err: unknown) => {
        if (isMounted) {
          process.exitCode = 1
          const message = err instanceof Error
            ? err.message
            : String(err)
          setState({ loading: false, error: message })
        }
      })

    return () => {
      isMounted = false
    }
  }, [store, key])

  if (state.loading) {
    return (
      <Box>
        <Text color="yellow">[RUNNING]</Text>
        <Text> Loading configuration...</Text>
      </Box>
    )
  }

  if (state.error) {
    return (
      <Box>
        <Text color="red">[ERROR]</Text>
        <Text>
          {' '}
          {state.error}
        </Text>
      </Box>
    )
  }

  const isObjectValue = typeof state.value === 'object' && state.value !== null
  const formattedValue = isObjectValue
    ? JSON.stringify(state.value, null, 2)
    : String(state.value)

  return (
    <Box flexDirection="column">
      <Box>
        <Text color="green">[OK]</Text>
        {!isObjectValue && (
          <Text>
            {' '}
            {formattedValue}
          </Text>
        )}
      </Box>
      {isObjectValue && (
        <Text>{formattedValue}</Text>
      )}
    </Box>
  )
}
