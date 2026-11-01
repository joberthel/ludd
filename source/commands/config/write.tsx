import type { ConfigSchema } from '../../store/config-store.js'
import type { Store } from '../../store/create-store.js'
import { Box, Text } from 'ink'
import React, { useEffect, useState } from 'react'
import zod, { ZodError } from 'zod'
import { configStore, writeConfigKey } from '../../store/config-store.js'

export const args = zod.tuple([
  zod.string().describe('Configuration key dot path (e.g. dummyObject.nestedString)'),
  zod.string().describe('Value to write'),
])

interface Props {
  args: zod.infer<typeof args>
  store?: Store<typeof ConfigSchema>
}

interface WriteState {
  loading: boolean
  error?: string
  result?: {
    key: string
    value: unknown
  }
}

export default function ConfigWrite({ args: [key, value], store = configStore }: Props) {
  const [state, setState] = useState<WriteState>({ loading: true })

  useEffect(() => {
    let isMounted = true

    writeConfigKey(store, key, value)
      .then((newValue) => {
        if (isMounted) {
          setState({
            loading: false,
            result: { key, value: newValue },
          })
        }
      })
      .catch((err: unknown) => {
        if (isMounted) {
          let message: string
          if (err instanceof ZodError) {
            message = err.issues.map(issue => `${issue.path.join('.') || key}: ${issue.message}`).join(', ')
          }
          else if (err instanceof Error) {
            message = err.message
          }
          else {
            message = String(err)
          }
          setState({ loading: false, error: message })
        }
      })

    return () => {
      isMounted = false
    }
  }, [store, key, value])

  if (state.loading) {
    return (
      <Box flexDirection="row">
        <Text color="yellow">[RUNNING]</Text>
        <Text> Writing configuration...</Text>
      </Box>
    )
  }

  if (state.error) {
    return (
      <Box flexDirection="row">
        <Text color="red">[ERROR]</Text>
        <Text>
          {' '}
          {state.error}
        </Text>
      </Box>
    )
  }

  if (!state.result) {
    return null
  }

  const formattedValue = typeof state.result.value === 'object' && state.result.value !== null
    ? JSON.stringify(state.result.value, null, 2)
    : String(state.result.value)

  return (
    <Box flexDirection="row">
      <Text color="green">[OK]</Text>
      <Text>
        {' '}
        {state.result.key}
        {' = '}
        {formattedValue}
      </Text>
    </Box>
  )
}
