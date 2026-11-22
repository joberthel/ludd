import type { KeyedRunUiEntry, RunOverallStatus, TreeNodeStatus } from './run-tree-state.js'
import { Box, Text, useInput } from 'ink'
import { useEffect, useState } from 'react'
import { buildRenderedLogLines } from './log-lines.js'
import { StatusCircle } from './status-circle.js'

export interface LogViewerPaneProps {
  breadcrumb: string
  selectedNodeId: string
  entries: readonly KeyedRunUiEntry[]
  focused: boolean
  width: number
  height: number
  status?: TreeNodeStatus | RunOverallStatus
  activity?: string
}

export function LogViewerPane({
  breadcrumb,
  selectedNodeId,
  entries,
  focused,
  width,
  height,
  status,
  activity,
}: LogViewerPaneProps) {
  const [showThoughts, setShowThoughts] = useState(true)
  const [expandOutput, setExpandOutput] = useState(false)

  const isRunning = status === 'running'
  const isWaiting = status === 'waiting' || status === 'waiting_for_gate'
  const showFooter = isRunning || isWaiting

  const viewportHeight = Math.max(1, height - 3 - (showFooter ? 1 : 0))
  const renderedLines = buildRenderedLogLines(entries, {
    width: Math.max(10, width - 4),
    showThoughts,
    expandOutput,
  })
  const totalLines = renderedLines.length
  const maxOffset = Math.max(0, totalLines - viewportHeight)

  const [autoScroll, setAutoScroll] = useState(true)
  const [scrollOffset, setScrollOffset] = useState(maxOffset)

  useEffect(() => {
    setAutoScroll(true)
    setScrollOffset(Math.max(0, totalLines - viewportHeight))
  }, [selectedNodeId])

  useEffect(() => {
    if (autoScroll) {
      setScrollOffset(Math.max(0, totalLines - viewportHeight))
    }
    else {
      setScrollOffset(prev => Math.min(prev, Math.max(0, totalLines - viewportHeight)))
    }
  }, [totalLines, viewportHeight, autoScroll])

  useInput((input, key) => {
    if (input === 't') {
      setShowThoughts(prev => !prev)
      return
    }
    if (input === 'o') {
      setExpandOutput(prev => !prev)
      return
    }
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
  const visibleLines = renderedLines.slice(effectiveOffset, effectiveOffset + viewportHeight)

  const showStatusTag = status === 'running' || status === 'failed' || isWaiting
  const statusTagText = isWaiting
    ? 'waiting'
    : status
  const badges: string[] = []
  if (!showThoughts) {
    badges.push('thoughts:off')
  }
  if (expandOutput) {
    badges.push('output:full')
  }

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
        <Box>
          {status !== undefined
            ? (
                <>
                  <StatusCircle status={status} />
                  <Text> </Text>
                </>
              )
            : null}
          <Text bold color={focused ? 'cyan' : undefined} wrap="truncate-end">
            {breadcrumb}
          </Text>
          {showStatusTag && statusTagText !== undefined
            ? (
                <Text dimColor>
                  {' · '}
                  {statusTagText}
                </Text>
              )
            : null}
        </Box>
        <Text dimColor>
          {badges.length > 0
            ? `${badges.join(' · ')} · `
            : ''}
          {entries.length}
          {' '}
          {entries.length === 1
            ? 'entry'
            : 'entries'}
          {!autoScroll && maxOffset > 0
            ? ` (${effectiveOffset + 1}/${totalLines})`
            : ''}
        </Text>
      </Box>
      <Box flexDirection="column" flexGrow={1}>
        {visibleLines.length === 0
          ? <Text dimColor>No logs for this selection yet.</Text>
          : visibleLines.map(line => (
              <Text
                key={line.key}
                color={line.color}
                bold={line.bold}
                dimColor={line.dimColor}
                italic={line.italic}
                wrap="truncate-end"
              >
                {line.text}
              </Text>
            ))}
      </Box>
      {showFooter
        ? (
            <Box>
              <StatusCircle status={status} />
              <Text dimColor wrap="truncate-end">
                {' '}
                {isWaiting
                  ? 'waiting for gate'
                  : activity !== undefined && activity !== ''
                    ? `running · ${activity}`
                    : 'running…'}
              </Text>
            </Box>
          )
        : null}
    </Box>
  )
}
