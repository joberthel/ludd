import type { AskQuestionInput } from './refine-mcp-server.js'
import { describe, expect, it } from 'vitest'
import { AskQuestionInputSchema, startRefineMcpServer } from './refine-mcp-server.js'

describe('refine-mcp-server', () => {
  it('validates AskQuestionInputSchema correctly', () => {
    const valid = {
      hypothesis: 'User wants dark mode',
      confidence: 85,
      missing: 'theme persistence details',
      question: 'Should theme persist across sessions?',
      guess: 'Yes, store in localStorage',
    }

    expect(AskQuestionInputSchema.parse(valid)).toEqual(valid)

    // missing is optional
    const withoutMissing = {
      hypothesis: 'User wants dark mode',
      confidence: 90,
      question: 'Should theme persist across sessions?',
      guess: 'Yes',
    }
    expect(AskQuestionInputSchema.parse(withoutMissing)).toEqual(withoutMissing)

    // confidence out of bounds
    expect(() => AskQuestionInputSchema.parse({ ...valid, confidence: 105 })).toThrow()
    expect(() => AskQuestionInputSchema.parse({ ...valid, confidence: -1 })).toThrow()

    // empty required strings
    expect(() => AskQuestionInputSchema.parse({ ...valid, hypothesis: '' })).toThrow()
    expect(() => AskQuestionInputSchema.parse({ ...valid, question: '   ' })).toThrow()
  })

  it('starts MCP server, lists ask_question tool, calls it, and shuts down', async () => {
    let capturedInput: AskQuestionInput | undefined

    const server = await startRefineMcpServer({
      onAskQuestion: async (input) => {
        capturedInput = input
        return 'Custom user response'
      },
    })

    expect(server.port).toBeGreaterThan(0)
    expect(server.url).toBe(`http://127.0.0.1:${server.port}/mcp`)

    try {
      // 1. Initialize
      const initResponse = await fetch(server.url, {
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
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'test-client', version: '1.0.0' },
          },
        }),
      })

      expect(initResponse.status).toBe(200)
      const sessionId = initResponse.headers.get('mcp-session-id')
      const requestHeaders: Record<string, string> = {
        'content-type': 'application/json',
        'accept': 'application/json, text/event-stream',
      }
      if (sessionId !== null && sessionId !== '') {
        requestHeaders['mcp-session-id'] = sessionId
      }

      // 2. tools/list
      const listResponse = await fetch(server.url, {
        method: 'POST',
        headers: requestHeaders,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/list',
          params: {},
        }),
      })

      expect(listResponse.status).toBe(200)
      const listData = await listResponse.json() as {
        result: {
          tools: Array<{
            name: string
            inputSchema: { properties: Record<string, unknown> }
          }>
        }
      }
      expect(listData.result.tools).toBeDefined()
      const tool = listData.result.tools.find(t => t.name === 'ask_question')
      expect(tool).toBeDefined()
      expect(tool?.inputSchema.properties).toHaveProperty('hypothesis')
      expect(tool?.inputSchema.properties).toHaveProperty('confidence')
      expect(tool?.inputSchema.properties).toHaveProperty('question')
      expect(tool?.inputSchema.properties).toHaveProperty('guess')

      // 3. tools/call
      const callResponse = await fetch(server.url, {
        method: 'POST',
        headers: requestHeaders,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: {
            name: 'ask_question',
            arguments: {
              hypothesis: 'Need CLI confirmation',
              confidence: 75,
              missing: 'confirmation flag',
              question: 'Add --yes flag?',
              guess: 'Yes, add --yes flag to skip prompt',
            },
          },
        }),
      })

      expect(callResponse.status).toBe(200)
      const callData = await callResponse.json() as {
        result: {
          content: Array<{ type: string, text: string }>
        }
      }
      expect(callData.result.content[0]?.type).toBe('text')
      const parsedText = JSON.parse(callData.result.content[0]!.text)
      expect(parsedText).toEqual({ answer: 'Custom user response' })

      expect(capturedInput).toEqual({
        hypothesis: 'Need CLI confirmation',
        confidence: 75,
        missing: 'confirmation flag',
        question: 'Add --yes flag?',
        guess: 'Yes, add --yes flag to skip prompt',
      })
    }
    finally {
      await server.close()
    }
  })

  it('defaults to returning guess when onAskQuestion is not provided', async () => {
    const server = await startRefineMcpServer()

    try {
      const initResponse = await fetch(server.url, {
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
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'test-client', version: '1.0.0' },
          },
        }),
      })
      const sessionId = initResponse.headers.get('mcp-session-id')
      const requestHeaders: Record<string, string> = {
        'content-type': 'application/json',
        'accept': 'application/json, text/event-stream',
      }
      if (sessionId !== null && sessionId !== '') {
        requestHeaders['mcp-session-id'] = sessionId
      }

      const callResponse = await fetch(server.url, {
        method: 'POST',
        headers: requestHeaders,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: {
            name: 'ask_question',
            arguments: {
              hypothesis: 'Default handler test',
              confidence: 90,
              question: 'Use default?',
              guess: 'Default answer',
            },
          },
        }),
      })

      expect(callResponse.status).toBe(200)
      const callData = await callResponse.json() as {
        result: {
          content: Array<{ type: string, text: string }>
        }
      }
      const parsedText = JSON.parse(callData.result.content[0]!.text)
      expect(parsedText).toEqual({ answer: 'Default answer' })
    }
    finally {
      await server.close()
    }
  })
})
