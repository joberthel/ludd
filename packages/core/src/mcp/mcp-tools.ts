import type { ArtifactClient } from '../types/artifact.js'
import type { LogStore } from '../types/log.js'
import { executeLogToolCall, MCP_LOG_TOOLS_LIST } from './mcp-log-tools.js'

export interface McpToolResult {
  content: Array<{ type: 'text', text: string }>
  isError?: boolean
}

export const MCP_ARTIFACT_TOOLS_LIST = [
  {
    name: 'put_artifact',
    description: 'Store a workflow artifact scoped to the current run.',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Artifact path/identifier' },
        content: { type: 'string', description: 'UTF-8 string content of the artifact' },
      },
      required: ['key', 'content'],
    },
  },
  {
    name: 'get_artifact',
    description: 'Retrieve a workflow artifact scoped to the current run.',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Artifact path/identifier' },
      },
      required: ['key'],
    },
  },
  {
    name: 'list_artifacts',
    description: 'List all workflow artifact keys scoped to the current run.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
]

export const MCP_TOOLS_LIST = [
  ...MCP_ARTIFACT_TOOLS_LIST,
  ...MCP_LOG_TOOLS_LIST,
]

async function handlePutArtifact(
  args: Record<string, unknown> | undefined,
  store: ArtifactClient,
): Promise<McpToolResult> {
  if (typeof args?.key !== 'string' || typeof args?.content !== 'string') {
    return {
      content: [
        { type: 'text', text: 'Invalid arguments: "key" and "content" must be strings.' },
      ],
      isError: true,
    }
  }
  try {
    await store.put(args.key, args.content)
    return {
      content: [
        { type: 'text', text: `Artifact "${args.key}" stored successfully.` },
      ],
    }
  }
  catch (error: unknown) {
    const message = (error as Error).message
    return {
      content: [
        { type: 'text', text: message },
      ],
      isError: true,
    }
  }
}

async function handleGetArtifact(
  args: Record<string, unknown> | undefined,
  store: ArtifactClient,
): Promise<McpToolResult> {
  if (typeof args?.key !== 'string') {
    return {
      content: [
        { type: 'text', text: 'Invalid arguments: "key" must be a string.' },
      ],
      isError: true,
    }
  }
  try {
    const content = await store.get(args.key)
    if (content === null) {
      return {
        content: [
          { type: 'text', text: `Artifact "${args.key}" not found.` },
        ],
        isError: true,
      }
    }
    return {
      content: [
        { type: 'text', text: content },
      ],
    }
  }
  catch (error: unknown) {
    const message = (error as Error).message
    return {
      content: [
        { type: 'text', text: message },
      ],
      isError: true,
    }
  }
}

async function handleListArtifacts(store: ArtifactClient): Promise<McpToolResult> {
  try {
    const list = store.list !== undefined
      ? await store.list()
      : []
    const jsonText = JSON.stringify(list, null, 2)
    return {
      content: [
        { type: 'text', text: jsonText },
      ],
    }
  }
  catch (error: unknown) {
    return {
      content: [
        { type: 'text', text: (error as Error).message },
      ],
      isError: true,
    }
  }
}

export async function executeToolCall(
  toolName: string,
  args: Record<string, unknown> | undefined,
  store: ArtifactClient,
  logStore?: LogStore,
): Promise<McpToolResult> {
  if (toolName === 'put_artifact') {
    return handlePutArtifact(args, store)
  }
  if (toolName === 'get_artifact') {
    return handleGetArtifact(args, store)
  }
  if (toolName === 'list_artifacts') {
    return handleListArtifacts(store)
  }
  if (toolName === 'read_log_page' || toolName === 'read_log_lines' || toolName === 'search_log') {
    if (!logStore) {
      return {
        content: [
          { type: 'text', text: 'Log store is not available.' },
        ],
        isError: true,
      }
    }
    return executeLogToolCall(toolName, args, logStore)
  }
  return {
    content: [
      { type: 'text', text: `Unknown tool: "${toolName}".` },
    ],
    isError: true,
  }
}

export function handleInitialize(id: unknown): Record<string, unknown> {
  return {
    jsonrpc: '2.0',
    id,
    result: {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'ludd-harness-mcp', version: '1.0.0' },
    },
  }
}

export function handleToolsList(id: unknown): Record<string, unknown> {
  return {
    jsonrpc: '2.0',
    id,
    result: {
      tools: MCP_TOOLS_LIST,
    },
  }
}
