import type { RefineIntent } from '../store/task-store.js'
import type { AskQuestionInput } from './refine-mcp-server.js'
import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/server'

export interface McpCallResult {
  jsonrpc: string
  id: number | string
  result?: {
    content?: Array<{ type: string, text: string }>
    isError?: boolean
  }
  error?: {
    code: number
    message: string
  }
}

export async function initMcpSession(url: string): Promise<string | undefined> {
  const initResponse = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'accept': 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: LATEST_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0.0' },
      },
    }),
  })

  const sessionId = initResponse.headers.get('mcp-session-id')
  if (sessionId !== null && sessionId !== '') {
    return sessionId
  }
  return undefined
}

let nextRpcId = 100

export async function callMcpTool(
  url: string,
  name: string,
  args: Record<string, unknown>,
  sessionId?: string,
  id = ++nextRpcId,
): Promise<McpCallResult> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'accept': 'application/json, text/event-stream',
  }
  if (sessionId !== undefined && sessionId !== '') {
    headers['mcp-session-id'] = sessionId
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id,
      method: 'tools/call',
      params: {
        name,
        arguments: args,
      },
    }),
  })

  return await response.json() as McpCallResult
}

export async function callGetInitialContext(
  url: string,
  args: Record<string, unknown> = {},
  sessionId?: string,
  id?: number,
): Promise<McpCallResult> {
  return callMcpTool(url, 'get_initial_context', args, sessionId, id)
}

export async function callAskQuestion(
  url: string,
  args: AskQuestionInput,
  sessionId?: string,
  id?: number,
): Promise<McpCallResult> {
  return callMcpTool(url, 'ask_question', args, sessionId, id)
}

export async function callCompleteRefinement(
  url: string,
  args: RefineIntent,
  sessionId?: string,
  id?: number,
): Promise<McpCallResult> {
  return callMcpTool(url, 'complete_refinement', args, sessionId, id)
}

export async function listMcpTools(
  url: string,
  sessionId?: string,
): Promise<{ result: { tools: Array<{ name: string, inputSchema: { properties: Record<string, unknown> } }> } }> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'accept': 'application/json, text/event-stream',
  }
  if (sessionId !== undefined && sessionId !== '') {
    headers['mcp-session-id'] = sessionId
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/list',
      params: {},
    }),
  })

  return await response.json() as {
    result: { tools: Array<{ name: string, inputSchema: { properties: Record<string, unknown> } }> }
  }
}
