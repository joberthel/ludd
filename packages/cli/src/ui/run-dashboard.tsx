import type { ActiveTtyPrompt } from './interactive-question-prompt.js'
import type { RunTreeAction, RunTreeState } from './run-tree-state.js'
import process from 'node:process'
import { Box, Text, useInput } from 'ink'
import { useEffect, useState } from 'react'
import { LogViewerPane } from './log-viewer-pane.js'
import { QuestionModal } from './question-modal.js'
import { flattenVisibleTree, getLogsForNode, getNodeBreadcrumb } from './run-tree-state.js'
import { StepTreePane } from './step-tree-pane.js'

export interface RunDashboardProps {
  state: RunTreeState
  dispatch: (action: RunTreeAction) => void
  activePrompt?: ActiveTtyPrompt
  status: 'running' | 'done' | 'error'
  errorMessage?: string
  onPromptSubmit: (answer: unknown) => void
  useAltScreen?: boolean
}

function getTerminalSize(): { columns: number, rows: number } {
  return {
    columns: process.stdout.columns || 100,
    rows: process.stdout.rows || 28,
  }
}

export function RunDashboard({
  state,
  dispatch,
  activePrompt,
  status,
  errorMessage,
  onPromptSubmit,
  useAltScreen = Boolean(process.stdout.isTTY),
}: RunDashboardProps) {
  const [size, setSize] = useState(getTerminalSize)
  const [focusPane, setFocusPane] = useState<'tree' | 'logs'>('tree')
  const [modalMinimized, setModalMinimized] = useState(false)

  useEffect(() => {
    setModalMinimized(false)
  }, [activePrompt])

  useEffect(() => {
    if (!useAltScreen) {
      return undefined
    }
    process.stdout.write('\x1B[?1049h\x1B[2J\x1B[H')
    return () => {
      process.stdout.write('\x1B[?1049l')
    }
  }, [useAltScreen])

  useEffect(() => {
    const onResize = (): void => {
      setSize(getTerminalSize())
    }
    process.stdout.on('resize', onResize)
    return () => {
      process.stdout.off('resize', onResize)
    }
  }, [])

  const modalOpen = activePrompt !== undefined && !modalMinimized

  useInput((input, key) => {
    if (activePrompt !== undefined && key.ctrl && input === 'b') {
      setModalMinimized(prev => !prev)
      return
    }
    if (!modalOpen && key.tab) {
      setFocusPane(prev => (prev === 'tree'
        ? 'logs'
        : 'tree'))
    }
  })

  const columns = size.columns
  const rows = size.rows
  const leftWidth = Math.max(28, Math.floor(columns * 0.35))
  const rightWidth = Math.max(30, columns - leftWidth)
  const bodyHeight = Math.max(8, rows - 2)

  const visibleRows = flattenVisibleTree(state)
  const filteredEntries = getLogsForNode(state, state.selectedNodeId)
  const breadcrumb = getNodeBreadcrumb(state, state.selectedNodeId)

  const statusColor = state.runStatus === 'passed'
    ? 'green'
    : state.runStatus === 'failed' || status === 'error'
      ? 'red'
      : state.runStatus === 'waiting_for_gate'
        ? 'yellow'
        : 'cyan'

  const statusText = status === 'error'
    ? 'failed'
    : state.runStatus.replaceAll('_', ' ')

  return (
    <Box position="relative" flexDirection="column" width={columns} height={rows}>
      <Box justifyContent="space-between" paddingX={1}>
        <Box>
          <Text bold color="cyan">
            {'◆ '}
            {state.harnessName}
          </Text>
          <Text> </Text>
          <Text bold color={statusColor}>
            [
            {statusText}
            ]
          </Text>
        </Box>
        {state.activity !== undefined
          ? <Text dimColor wrap="truncate-end">{state.activity}</Text>
          : null}
      </Box>

      <Box flexDirection="row" height={bodyHeight}>
        <StepTreePane
          rows={visibleRows}
          focused={!modalOpen && focusPane === 'tree'}
          followActive={state.followActive}
          width={leftWidth}
          height={bodyHeight}
          onMoveSelection={delta => dispatch({ type: 'MOVE_SELECTION', delta })}
          onToggleExpand={nodeId => dispatch({ type: 'TOGGLE_EXPAND', nodeId })}
          onToggleFollow={() => dispatch({ type: 'SET_FOLLOW_ACTIVE', follow: !state.followActive })}
        />
        <LogViewerPane
          breadcrumb={breadcrumb}
          selectedNodeId={state.selectedNodeId}
          entries={filteredEntries}
          focused={!modalOpen && focusPane === 'logs'}
          width={rightWidth}
          height={bodyHeight}
        />
      </Box>

      <Box paddingX={1}>
        {activePrompt !== undefined && modalMinimized
          ? <Text bold color="yellow">⏸ Question waiting — press Ctrl+B to answer</Text>
          : status === 'error' && errorMessage !== undefined
            ? (
                <Text color="red" wrap="truncate-end">
                  {'✖ '}
                  {errorMessage}
                </Text>
              )
            : (
                <Text dimColor wrap="truncate-end">
                  Tab: switch pane · ↑/↓: navigate · Enter/Space: expand · f: follow · g/G: top/bottom
                </Text>
              )}
      </Box>

      {activePrompt !== undefined
        ? (
            <QuestionModal
              prompt={activePrompt}
              contextLabel={getNodeBreadcrumb(state, state.activeNodeId)}
              minimized={modalMinimized}
              width={columns}
              onSubmit={onPromptSubmit}
            />
          )
        : null}
    </Box>
  )
}
