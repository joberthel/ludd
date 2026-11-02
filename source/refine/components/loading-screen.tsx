import { Spinner } from '@inkjs/ui'
import { Box, Text } from 'ink'

export type InitStage
  = | 'starting-mcp'
    | 'verifying-skill'
    | 'spawning-agent'
    | 'waiting-agent-first-question'

export interface LoadingScreenProps {
  taskId: number | string
  taskName: string
  model: string
  stage: InitStage
  mcpPort?: number
  agentPid?: number
  skillPath?: string
}

const STAGE_ORDER: InitStage[] = [
  'starting-mcp',
  'verifying-skill',
  'spawning-agent',
  'waiting-agent-first-question',
]

export function LoadingScreen({
  taskId,
  taskName,
  model,
  stage,
  mcpPort,
  agentPid,
}: LoadingScreenProps) {
  const currentStageIndex = STAGE_ORDER.indexOf(stage)
  const mcpPortSuffix = mcpPort !== undefined
    ? ` (port ${mcpPort})`
    : ''
  const agentPidSuffix = agentPid !== undefined
    ? ` (PID ${agentPid})`
    : ''

  return (
    <Box flexDirection="column" flexGrow={1} padding={1}>
      <Box borderStyle="round" flexDirection="column" marginBottom={1} paddingX={1} width="100%">
        <Text bold color="cyan">
          {`Refining Task #${taskId}: ${taskName}`}
        </Text>
        <Text dimColor>
          {`Model: ${model}`}
        </Text>
      </Box>

      <Box flexDirection="column" gap={1}>
        <Box>
          {currentStageIndex > 0
            ? (
                <Text>
                  <Text bold color="green">[OK]</Text>
                  {` MCP server started${mcpPortSuffix}`}
                </Text>
              )
            : currentStageIndex === 0
              ? <Spinner label="Starting MCP server..." />
              : <Text dimColor>[ ] Starting MCP server</Text>}
        </Box>

        <Box>
          {currentStageIndex > 1
            ? (
                <Text>
                  <Text bold color="green">[OK]</Text>
                  {' Refinement skill verified'}
                </Text>
              )
            : currentStageIndex === 1
              ? <Spinner label="Verifying refinement skill..." />
              : <Text dimColor>[ ] Verifying refinement skill</Text>}
        </Box>

        <Box>
          {currentStageIndex > 2
            ? (
                <Text>
                  <Text bold color="green">[OK]</Text>
                  {` agy agent session launched${agentPidSuffix}`}
                </Text>
              )
            : currentStageIndex === 2
              ? <Spinner label="Launching agy agent session..." />
              : <Text dimColor>[ ] Launching agy agent session</Text>}
        </Box>

        {currentStageIndex >= 3
          ? (
              <Box>
                <Spinner label="Waiting for agent to formulate first question..." />
              </Box>
            )
          : null}
      </Box>
    </Box>
  )
}
