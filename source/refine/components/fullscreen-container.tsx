import type React from 'react'
import process from 'node:process'
import { Box, useStdout, useWindowSize } from 'ink'
import { useEffect } from 'react'

export interface FullscreenContainerProps {
  children?: React.ReactNode
  disabled?: boolean
  stdout?: NodeJS.WriteStream
}

export function FullscreenContainer({
  children,
  disabled,
  stdout: customStdout,
}: FullscreenContainerProps) {
  const { stdout: inkStdout } = useStdout()
  const windowSize = useWindowSize()

  const columns = typeof windowSize?.columns === 'number' && windowSize.columns > 0
    ? windowSize.columns
    : 80
  const rows = typeof windowSize?.rows === 'number' && windowSize.rows > 0
    ? windowSize.rows
    : 24

  useEffect(() => {
    const stream = customStdout ?? inkStdout ?? process.stdout
    const isTTY = 'isTTY' in stream && (stream as { isTTY?: boolean }).isTTY === true
    const isTest = process.env.NODE_ENV === 'test'

    let shouldEnable = false
    if (disabled === false) {
      shouldEnable = true
    }
    else if (disabled === true) {
      shouldEnable = false
    }
    else {
      shouldEnable = isTTY && !isTest
    }

    if (!shouldEnable) {
      return
    }

    let restored = false
    const restoreTerminal = () => {
      if (restored) {
        return
      }
      restored = true
      try {
        stream.write('\x1B[?1049l\x1B[?25h')
      }
      catch {}
    }

    try {
      stream.write('\x1B[?1049h\x1B[H')
    }
    catch {}

    const onExit = () => restoreTerminal()
    const onSigint = () => {
      restoreTerminal()
      process.exit(130)
    }
    const onSigterm = () => {
      restoreTerminal()
      process.exit(143)
    }

    process.on('exit', onExit)
    process.on('SIGINT', onSigint)
    process.on('SIGTERM', onSigterm)

    return () => {
      process.off('exit', onExit)
      process.off('SIGINT', onSigint)
      process.off('SIGTERM', onSigterm)
      restoreTerminal()
    }
  }, [disabled, customStdout, inkStdout])

  return (
    <Box flexDirection="column" height={rows} width={columns}>
      {children}
    </Box>
  )
}
