import type { LogStore } from '../types/log.js'
import type { McpToolResult } from './mcp-tools.js'

export const MCP_LOG_TOOLS_LIST = [
  {
    name: 'read_log_page',
    description: 'Read a paginated page of an offloaded log (supports plain text lines and structured JSON items).',
    inputSchema: {
      type: 'object',
      properties: {
        logKey: { type: 'string', description: 'Log identifier or filename' },
        page: { type: 'number', description: '1-based page number (default 1)' },
        pageSize: { type: 'number', description: 'Number of lines or items per page (default 100)' },
      },
      required: ['logKey'],
    },
  },
  {
    name: 'read_log_lines',
    description: 'Read a bounded 1-based inclusive range of lines from an offloaded plain-text log.',
    inputSchema: {
      type: 'object',
      properties: {
        logKey: { type: 'string', description: 'Log identifier or filename' },
        startLine: { type: 'number', description: '1-based starting line number' },
        endLine: { type: 'number', description: '1-based ending line number (inclusive)' },
      },
      required: ['logKey', 'startLine', 'endLine'],
    },
  },
  {
    name: 'search_log',
    description: 'Search for matching lines in an offloaded log file by substring query.',
    inputSchema: {
      type: 'object',
      properties: {
        logKey: { type: 'string', description: 'Log identifier or filename' },
        query: { type: 'string', description: 'Substring to search for' },
        maxMatches: { type: 'number', description: 'Maximum number of matches to return (default 50)' },
      },
      required: ['logKey', 'query'],
    },
  },
]

function errorResult(message: string): McpToolResult {
  return {
    content: [
      { type: 'text', text: message },
    ],
    isError: true,
  }
}

function successResult(data: unknown): McpToolResult {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(data, null, 2),
      },
    ],
  }
}

export async function handleReadLogPage(
  args: Record<string, unknown> | undefined,
  logStore: LogStore,
): Promise<McpToolResult> {
  if (typeof args?.logKey !== 'string' || args.logKey.trim() === '') {
    return errorResult('Invalid arguments: "logKey" must be a non-empty string.')
  }
  const page = typeof args.page === 'number' && Number.isInteger(args.page)
    ? args.page
    : 1
  const pageSize = typeof args.pageSize === 'number' && Number.isInteger(args.pageSize)
    ? args.pageSize
    : 100

  const result = await logStore.readPage(args.logKey, page, pageSize)
  if (result === null) {
    return errorResult(`Log "${args.logKey}" not found.`)
  }
  return successResult(result)
}

export async function handleReadLogLines(
  args: Record<string, unknown> | undefined,
  logStore: LogStore,
): Promise<McpToolResult> {
  if (typeof args?.logKey !== 'string' || args.logKey.trim() === '') {
    return errorResult('Invalid arguments: "logKey" must be a non-empty string.')
  }
  if (typeof args.startLine !== 'number' || typeof args.endLine !== 'number') {
    return errorResult('Invalid arguments: "startLine" and "endLine" must be numbers.')
  }

  const result = await logStore.readLines(args.logKey, args.startLine, args.endLine)
  if (result === null) {
    return errorResult(`Log "${args.logKey}" not found.`)
  }
  return successResult(result)
}

export async function handleSearchLog(
  args: Record<string, unknown> | undefined,
  logStore: LogStore,
): Promise<McpToolResult> {
  if (typeof args?.logKey !== 'string' || args.logKey.trim() === '') {
    return errorResult('Invalid arguments: "logKey" must be a non-empty string.')
  }
  if (typeof args.query !== 'string') {
    return errorResult('Invalid arguments: "query" must be a string.')
  }
  const maxMatches = typeof args.maxMatches === 'number' && Number.isInteger(args.maxMatches)
    ? args.maxMatches
    : 50

  const result = await logStore.search(args.logKey, args.query, maxMatches)
  if (result === null) {
    return errorResult(`Log "${args.logKey}" not found.`)
  }
  return successResult(result)
}

export async function executeLogToolCall(
  toolName: string,
  args: Record<string, unknown> | undefined,
  logStore: LogStore,
): Promise<McpToolResult> {
  if (toolName === 'read_log_page') {
    return handleReadLogPage(args, logStore)
  }
  if (toolName === 'read_log_lines') {
    return handleReadLogLines(args, logStore)
  }
  if (toolName === 'search_log') {
    return handleSearchLog(args, logStore)
  }
  return errorResult(`Unknown tool: "${toolName}".`)
}
