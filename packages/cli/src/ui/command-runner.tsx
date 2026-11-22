import process from 'node:process'
import { Spinner, StatusMessage } from '@inkjs/ui'
import { useEffect, useState } from 'react'

export interface CommandRunnerProps {
  /** Executes the underlying CLI action and resolves to an exit code. */
  execute: () => Promise<number>
  /** Optional spinner label shown while the command is executing. */
  spinnerLabel?: string
}

export function CommandRunner({ execute, spinnerLabel }: CommandRunnerProps) {
  const [status, setStatus] = useState<'running' | 'done' | 'error'>('running')
  const [errorMessage, setErrorMessage] = useState<string | undefined>()

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

  if (status === 'error' && errorMessage !== undefined) {
    return <StatusMessage variant="error">{errorMessage}</StatusMessage>
  }
  if (status === 'running' && spinnerLabel !== undefined) {
    return <Spinner label={spinnerLabel} />
  }
  return null
}
