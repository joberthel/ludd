import type { RunOverallStatus, TreeNodeStatus, VisibleTreeRow } from './run-tree-state.js'
import { Box, Text, useInput } from 'ink'

export interface StepTreePaneProps {
  rows: readonly VisibleTreeRow[]
  focused: boolean
  followActive: boolean
  width: number
  height: number
  onMoveSelection: (delta: number) => void
  onToggleExpand: (nodeId?: string) => void
  onToggleFollow: () => void
}

function getStatusGlyph(status: TreeNodeStatus | RunOverallStatus): { glyph: string, color: string } {
  switch (status) {
    case 'running':
      return { glyph: '●', color: 'cyan' }
    case 'waiting':
    case 'waiting_for_gate':
      return { glyph: '⏸', color: 'yellow' }
    case 'passed':
      return { glyph: '✔', color: 'green' }
    case 'failed':
      return { glyph: '✖', color: 'red' }
    case 'skipped':
      return { glyph: '↷', color: 'gray' }
    case 'pending':
      return { glyph: '○', color: 'gray' }
  }
}

export function StepTreePane({
  rows,
  focused,
  followActive,
  width,
  height,
  onMoveSelection,
  onToggleExpand,
  onToggleFollow,
}: StepTreePaneProps) {
  useInput((input, key) => {
    if (key.upArrow || input === 'k') {
      onMoveSelection(-1)
      return
    }
    if (key.downArrow || input === 'j') {
      onMoveSelection(1)
      return
    }
    if (key.return || input === ' ' || key.rightArrow || key.leftArrow) {
      onToggleExpand()
      return
    }
    if (input === 'f') {
      onToggleFollow()
    }
  }, { isActive: focused })

  const innerHeight = Math.max(1, height - 3)
  const selectedIndex = Math.max(0, rows.findIndex(r => r.isSelected))
  const start = Math.max(0, Math.min(rows.length - innerHeight, selectedIndex - Math.floor(innerHeight / 2)))
  const visibleRows = rows.slice(start, start + innerHeight)

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
        <Text bold color={focused ? 'cyan' : undefined}>Steps</Text>
        <Text dimColor={!followActive} color={followActive ? 'green' : undefined}>
          {followActive ? 'follow:on' : 'follow:off'}
        </Text>
      </Box>
      <Box flexDirection="column" flexGrow={1}>
        {visibleRows.map((row) => {
          const { glyph, color } = getStatusGlyph(row.status)
          const indent = '  '.repeat(row.depth)
          const expandIcon = row.hasChildren
            ? (row.isExpanded ? '▾ ' : '▸ ')
            : '  '
          const badge = row.badge !== undefined
            ? ` [${row.badge}]`
            : ''
          return (
            <Box key={row.id}>
              <Text
                wrap="truncate-end"
                inverse={row.isSelected}
                bold={row.isSelected || row.isActive}
              >
                {indent}
                {expandIcon}
                <Text color={color}>{glyph}</Text>
                {' '}
                {row.label}
                {badge !== ''
                  ? <Text dimColor>{badge}</Text>
                  : null}
              </Text>
            </Box>
          )
        })}
      </Box>
    </Box>
  )
}
