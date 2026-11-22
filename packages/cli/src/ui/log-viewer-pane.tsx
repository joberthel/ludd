import type { KeyedRunUiEntry } from './run-tree-state.js'
import { Box, Text, useInput } from 'ink'
import { useEffect, useState } from 'react'
import { RunLogEntry } from './run-log-entry.js'

export interface LogViewerPaneProps {
  breadcrumb: string
  selectedNodeId: string
  entries: readonly KeyedRunUiEntry[]
  focused: boolean
  width: number
  height: number
}

export function LogViewerPane({
  breadcrumb,
  selectedNodeId,
  entries,
  focused,
  width,
  height,
}: LogViewerPaneProps) {
  const viewportHeight = Math.max(1, height - 3)
  const maxOffset = Math.max(0, entries.length - viewportHeight)
  const [autoScroll, setAutoScroll] = useState(true)
  const [scrollOffset, setScrollOffset] = useState(maxOffset)

  useEffect(() => {
    setAutoScroll(true)
    setScrollOffset(Math.max(0, entries.length - viewportHeight))
  }, [selectedNodeId])

  useEffect(() => {
    if (autoScroll) {
      setScrollOffset(Math.max(0, entries.length - viewportHeight))
    }
    else {
      setScrollOffset(prev => Math.min(prev, Math.max(0, entries.length - viewportHeight)))
    }
  }, [entries.length, viewportHeight, autoScroll])

  useInput((input, key) => {
    if (key.upArrow || input === 'k') {
      setAutoScroll(false)
      setScrollOffset(prev => Math.max(0, prev - 1))
      return
    }
    if (key.downArrow || input === 'j') {
      setScrollOffset((prev) => {
        const next = Math.min(maxOffset, prev + 1)
        if (next >= maxOffset) {
          setAutoScroll(true)
        }
        return next
      })
      return
    }
    if (key.pageUp) {
      setAutoScroll(false)
      setScrollOffset(prev => Math.max(0, prev - Math.max(1, viewportHeight - 1)))
      return
    }
    if (key.pageDown) {
      setScrollOffset((prev) => {
        const next = Math.min(maxOffset, prev + Math.max(1, viewportHeight - 1))
        if (next >= maxOffset) {
          setAutoScroll(true)
        }
        return next
      })
      return
    }
    if (input === 'g') {
      setAutoScroll(false)
      setScrollOffset(0)
      return
    }
    if (input === 'G') {
      setAutoScroll(true)
      setScrollOffset(maxOffset)
    }
  }, { isActive: focused })

  const effectiveOffset = autoScroll
    ? maxOffset
    : Math.min(scrollOffset, maxOffset)
  const visibleEntries = entries.slice(effectiveOffset, effectiveOffset + viewportHeight)

  return (
    <Box
      flexDirection="column"
      width={width}
      height={height}
      borderStyle="round"
      borderColor={focused ? 'cyan' : 'gray'}
      paddingX={1}
    >
      <Box justifyContent="space-between">
        <Text bold color={focused ? 'cyan' : undefined} wrap="truncate-end">
          {breadcrumb}
        </Text>
        <Text dimColor>
          {entries.length}
          {' '}
          {entries.length === 1
            ? 'entry'
            : 'entries'}
          {!autoScroll && maxOffset > 0
            ? ` (${effectiveOffset + 1}/${entries.length})`
            : ''}
        </Text>
      </Box>
      <Box flexDirection="column" flexGrow={1}>
        {visibleEntries.length === 0
          ? <Text dimColor>No logs for this selection yet.</Text>
          : visibleEntries.map(entry => (
              <RunLogEntry key={entry.id} entry={entry} />
            ))}
      </Box>
    </Box>
  )
}
