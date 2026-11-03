import { Box, Text } from 'ink'

export interface StatusbarProps {
  confidence?: number
  model: string
  mcpStatus: string
  agyStatus?: string
  historyCount?: number
}

function getConfidenceColor(confidence: number | undefined): 'cyan' | 'green' | 'yellow' {
  if (confidence === undefined || confidence < 70) {
    return 'yellow'
  }
  if (confidence >= 95) {
    return 'cyan'
  }
  return 'green'
}

function getStatusColor(status: string): 'cyan' | 'green' | 'yellow' {
  const normalized = status.toLowerCase()
  if (normalized.includes('connected') || normalized.includes('ready') || normalized.includes('ok') || normalized.includes('running')) {
    return 'green'
  }
  if (normalized.includes('starting') || normalized.includes('init')) {
    return 'yellow'
  }
  return 'cyan'
}

export function Statusbar({
  confidence,
  model,
  mcpStatus,
  agyStatus,
  historyCount,
}: StatusbarProps) {
  const confidenceColor = getConfidenceColor(confidence)
  const mcpColor = getStatusColor(mcpStatus)
  const agyColor = agyStatus !== undefined
    ? getStatusColor(agyStatus)
    : 'cyan'

  return (
    <Box borderStyle="single" flexDirection="row" justifyContent="space-between" width="100%">
      <Box>
        <Text>
          {'Confidence: '}
          {confidence !== undefined
            ? <Text bold color={confidenceColor}>{`${confidence}%`}</Text>
            : <Text dimColor>--%</Text>}
        </Text>
        <Text> | </Text>
        <Text>
          {'Model: '}
          <Text bold>{model}</Text>
        </Text>
        <Text> | </Text>
        <Text>
          {'MCP: '}
          <Text color={mcpColor}>{mcpStatus}</Text>
        </Text>
        {agyStatus !== undefined && (
          <>
            <Text> | </Text>
            <Text>
              {'Agent: '}
              <Text color={agyColor}>{agyStatus}</Text>
            </Text>
          </>
        )}
      </Box>
      <Box>
        <Text dimColor>
          {historyCount !== undefined && historyCount > 0
            ? `[PgUp/PgDn] History (${historyCount})`
            : '[PgUp/PgDn] History'}
        </Text>
      </Box>
    </Box>
  )
}
