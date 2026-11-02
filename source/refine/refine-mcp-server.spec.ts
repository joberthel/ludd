import type { AskQuestionInput } from './refine-mcp-server.js'
import http from 'node:http'
import { describe, expect, it } from 'vitest'
import { AskQuestionInputSchema, startRefineMcpServer } from './refine-mcp-server.js'
import { callAskQuestion, initMcpSession, listMcpTools } from './test-helpers.js'

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
    expect(server.url).toBe(`http://127.0.0.1:${server.port}/mcp/${server.sessionToken}`)

    try {
      const sessionId = await initMcpSession(server.url)

      const listData = await listMcpTools(server.url, sessionId)
      expect(listData.result.tools).toBeDefined()
      const tool = listData.result.tools.find(t => t.name === 'ask_question')
      expect(tool).toBeDefined()
      expect(tool?.inputSchema.properties).toHaveProperty('hypothesis')
      expect(tool?.inputSchema.properties).toHaveProperty('confidence')
      expect(tool?.inputSchema.properties).toHaveProperty('question')
      expect(tool?.inputSchema.properties).toHaveProperty('guess')

      const callData = await callAskQuestion(
        server.url,
        {
          hypothesis: 'Need CLI confirmation',
          confidence: 75,
          missing: 'confirmation flag',
          question: 'Add --yes flag?',
          guess: 'Yes, add --yes flag to skip prompt',
        },
        sessionId,
      )

      expect(callData.result?.content?.[0]?.type).toBe('text')
      const parsedText = JSON.parse(callData.result!.content![0]!.text)
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

  it('returns 404 for invalid path or wrong session token', async () => {
    const server = await startRefineMcpServer({
      onAskQuestion: async input => input.guess,
    })

    try {
      // Root path returns 404
      const rootRes = await fetch(`http://127.0.0.1:${server.port}/`, {
        method: 'POST',
      })
      expect(rootRes.status).toBe(404)

      // Base /mcp path without token returns 404
      const baseMcpRes = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
        method: 'POST',
      })
      expect(baseMcpRes.status).toBe(404)

      // Wrong token path returns 404
      const wrongTokenRes = await fetch(`http://127.0.0.1:${server.port}/mcp/wrong-token-12345`, {
        method: 'POST',
      })
      expect(wrongTokenRes.status).toBe(404)
    }
    finally {
      await server.close()
    }
  })

  it('rejects requests from untrusted Host headers (DNS rebinding protection)', async () => {
    const server = await startRefineMcpServer({
      onAskQuestion: async input => input.guess,
    })

    try {
      const url = new URL(server.url)
      const res = await new Promise<{ body: string, status?: number }>((resolve, reject) => {
        const req = http.request({
          hostname: '127.0.0.1',
          port: server.port,
          path: url.pathname,
          method: 'POST',
          headers: {
            'host': 'evil-rebinding.com',
            'content-type': 'application/json',
            'accept': 'application/json, text/event-stream',
          },
        }, (response) => {
          let body = ''
          response.on('data', chunk => (body += String(chunk)))
          response.on('end', () => resolve({ status: response.statusCode, body }))
        })
        req.on('error', reject)
        req.write(JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
        }))
        req.end()
      })

      expect(res.status).toBe(403)
      const data = JSON.parse(res.body) as { error: { message: string } }
      expect(data.error.message).toContain('Invalid Host header')
    }
    finally {
      await server.close()
    }
  })

  it('returns a tool error when onAskQuestion rejects or throws', async () => {
    const server = await startRefineMcpServer({
      onAskQuestion: async () => {
        throw new Error('User declined to answer')
      },
    })

    try {
      const sessionId = await initMcpSession(server.url)
      const callData = await callAskQuestion(
        server.url,
        {
          hypothesis: 'Test hypothesis',
          confidence: 80,
          question: 'Will this fail?',
          guess: 'Yes',
        },
        sessionId,
      )

      expect(callData.result?.isError).toBe(true)
      expect(callData.result?.content?.[0]?.text).toContain('User declined to answer')
    }
    finally {
      await server.close()
    }
  })
})
