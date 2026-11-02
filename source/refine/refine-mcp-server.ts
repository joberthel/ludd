import type { IncomingMessage, ServerResponse } from 'node:http'
import crypto from 'node:crypto'
import http from 'node:http'
import { Readable } from 'node:stream'
import {
  localhostAllowedHostnames,
  localhostAllowedOrigins,
  McpServer,
  WebStandardStreamableHTTPServerTransport,
} from '@modelcontextprotocol/server'
import { z as zod } from 'zod'

export const AskQuestionInputSchema = zod.object({
  hypothesis: zod.string().trim().min(1).describe('One-sentence best read of what the user wants'),
  confidence: zod.number().int().min(0).max(100).describe('Honest confidence level from 0 to 100'),
  missing: zod.string().trim().optional().describe('What is still unresolved when confidence is below 70%'),
  question: zod.string().trim().min(1).describe('One focused question for the user'),
  guess: zod.string().trim().min(1).describe('Best hypothesis for the answer and why'),
}).strict()

export type AskQuestionInput = zod.infer<typeof AskQuestionInputSchema>

export interface StartRefineMcpServerOptions {
  port?: number
  onAskQuestion: (input: AskQuestionInput) => Promise<string>
}

export interface RefineMcpServerInstance {
  port: number
  url: string
  sessionToken: string
  close: () => Promise<void>
}

export async function startRefineMcpServer(
  options: StartRefineMcpServerOptions,
): Promise<RefineMcpServerInstance> {
  const sessionToken = crypto.randomBytes(16).toString('hex')
  const expectedPath = `/mcp/${sessionToken}`

  const mcpServer = new McpServer({
    name: 'ludd-refine',
    version: '0.0.0',
  })

  mcpServer.registerTool(
    'ask_question',
    {
      description: 'Ask a focused question during task refinement interview',
      inputSchema: AskQuestionInputSchema,
    },
    async (args) => {
      const answer = await options.onAskQuestion(args)
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ answer }),
          },
        ],
      }
    },
  )

  let transport: WebStandardStreamableHTTPServerTransport | undefined

  async function handleHttpRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (url.pathname !== expectedPath) {
      res.statusCode = 404
      res.end('Not Found')
      return
    }

    if (transport === undefined) {
      res.statusCode = 503
      res.end('Service Unavailable')
      return
    }

    const headers = new Headers()
    for (const [key, value] of Object.entries(req.headers)) {
      if (value === undefined)
        continue
      if (Array.isArray(value)) {
        for (const item of value) {
          headers.append(key, item)
        }
      }
      else {
        headers.set(key, value)
      }
    }

    const hasBody = req.method !== 'GET' && req.method !== 'HEAD'
    const webReq = new Request(url, {
      method: req.method,
      headers,
      body: hasBody
        ? (Readable.toWeb(req) as unknown as ReadableStream)
        : null,
      ...({ duplex: 'half' } as Record<string, string>),
    })

    const webRes = await transport.handleRequest(webReq)
    res.statusCode = webRes.status
    webRes.headers.forEach((value, name) => {
      res.setHeader(name, value)
    })

    if (webRes.body !== null) {
      Readable.fromWeb(webRes.body as unknown as Parameters<typeof Readable.fromWeb>[0]).pipe(res)
    }
    else {
      res.end()
    }
  }

  const httpServer = http.createServer((req: IncomingMessage, res: ServerResponse) => {
    void handleHttpRequest(req, res).catch(() => {
      if (!res.headersSent) {
        res.statusCode = 500
        res.end('Internal Server Error')
      }
    })
  })

  await new Promise<void>((resolve, reject) => {
    httpServer.listen(options.port ?? 0, '127.0.0.1', () => {
      resolve()
    })
    httpServer.once('error', reject)
  })

  const address = httpServer.address()
  if (address === null || typeof address === 'string') {
    throw new Error('Failed to bind MCP HTTP server to an address')
  }

  const port = address.port
  const url = `http://127.0.0.1:${port}${expectedPath}`

  const baseHosts = localhostAllowedHostnames()
  const allowedHosts = [
    ...baseHosts,
    ...baseHosts.map(h => `${h}:${port}`),
  ]
  const baseOrigins = localhostAllowedOrigins()
  const allowedOrigins = [
    ...baseOrigins,
    ...baseOrigins.map(o => `http://${o}:${port}`),
  ]

  transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
    enableJsonResponse: true,
    enableDnsRebindingProtection: true,
    allowedHosts,
    allowedOrigins,
  })

  await mcpServer.connect(transport)

  return {
    port,
    url,
    sessionToken,
    close: async () => {
      httpServer.closeAllConnections?.()
      await new Promise<void>((resolve) => {
        httpServer.close(() => resolve())
      })
      await mcpServer.close()
    },
  }
}
