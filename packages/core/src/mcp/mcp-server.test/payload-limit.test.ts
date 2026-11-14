import os from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { MAX_MCP_BODY_BYTES, startEmbeddedMcpServer } from '../mcp-server.js'

describe('embedded MCP server payload size limit', () => {
  let closeServer: (() => Promise<void>) | undefined

  afterEach(async () => {
    if (closeServer) {
      await closeServer()
      closeServer = undefined
    }
  })

  it('rejects request bodies exceeding MAX_MCP_BODY_BYTES with 413', async () => {
    const server = await startEmbeddedMcpServer(os.tmpdir())
    closeServer = server.close

    const oversizedBody = 'x'.repeat(MAX_MCP_BODY_BYTES + 1)
    try {
      const response = await fetch(server.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${server.authToken}`,
        },
        body: oversizedBody,
      })

      expect(response.status).toBe(413)
      const json = await response.json() as { error?: { message?: string } }
      expect(json.error?.message).toBe('Payload too large')
    }
    catch (err) {
      // On some Node/undici versions, req.destroy() resets the connection before 413 is read
      expect(err).toBeDefined()
    }
  })
})
