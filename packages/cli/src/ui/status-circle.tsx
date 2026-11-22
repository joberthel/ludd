import type { RunOverallStatus, TreeNodeStatus } from './run-tree-state.js'
import { Text } from 'ink'

export interface StatusCircleMeta {
  glyph: string
  color: string
  label: string
}

export function getStatusCircle(status: TreeNodeStatus | RunOverallStatus): StatusCircleMeta {
  switch (status) {
    case 'running':
      return { glyph: '●', color: 'cyan', label: 'running' }
    case 'waiting':
    case 'waiting_for_gate':
      return { glyph: '●', color: 'yellow', label: 'waiting' }
    case 'passed':
      return { glyph: '●', color: 'green', label: 'passed' }
    case 'failed':
      return { glyph: '●', color: 'red', label: 'failed' }
    case 'skipped':
      return { glyph: '○', color: 'gray', label: 'skipped' }
    case 'pending':
      return { glyph: '○', color: 'gray', label: 'pending' }
  }
}

export interface StatusCircleProps {
  status: TreeNodeStatus | RunOverallStatus
  showLabel?: boolean
}

export function StatusCircle({ status, showLabel = false }: StatusCircleProps) {
  const meta = getStatusCircle(status)
  return (
    <Text color={meta.color}>
      {meta.glyph}
      {showLabel
        ? ` ${meta.label}`
        : ''}
    </Text>
  )
}
