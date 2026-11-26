import type {
  AgentAccessMode,
  AgentMcpConnection,
  AgentRunner,
  AgentStepOutput,
  AgentStreamEvent,
  AgentStreamEventType,
  AgentTurnInput,
  AgentTurnResult,
} from '@luddjs/core'
import type {
  AcpAgentConfig,
  AcpMcpBridgeConfig,
  AcpPermissionMode,
  AcpStdioMcpServerConfig,
} from './acp-agent.js'
import type { AcpPresetOptions } from './acp-presets.js'
import type {
  MockAgentConfig,
  MockAgentResponse,
  MockAgentRunner,
} from './mock-agent.js'

export { acpAgent } from './acp-agent.js'
export { agyAcp, claudeAcp, codexAcp } from './acp-presets.js'
export { mockAgent } from './mock-agent.js'
export {
  appendStreamEvent,
  readStreamEvents,
  resolveStreamPath,
} from '@luddjs/core'

export type {
  AcpAgentConfig,
  AcpMcpBridgeConfig,
  AcpPermissionMode,
  AcpPresetOptions,
  AcpStdioMcpServerConfig,
  AgentAccessMode,
  AgentMcpConnection,
  AgentRunner,
  AgentStepOutput,
  AgentStreamEvent,
  AgentStreamEventType,
  AgentTurnInput,
  AgentTurnResult,
  MockAgentConfig,
  MockAgentResponse,
  MockAgentRunner,
}
