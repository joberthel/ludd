import type { AgentRunner, AgentTurnInput } from '../../types/agent.js'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runHarness } from '../run-harness.js'

async function callPutArtifact(mcpServerUrl: string, mcpAuthToken: string, key: string, content: string): Promise<void> {
  const res = await fetch(mcpServerUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${mcpAuthToken}`,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'call-1',
      method: 'tools/call',
      params: {
        name: 'put_artifact',
        arguments: { key, content },
      },
    }),
  })
  const json = await res.json()
  expect(json.result.isError).toBeUndefined()
}

describe('runHarness artifact store pipeline integration', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ludd-harness-mcp-test-'))
  })

  afterEach(async () => {
    await fs.promises.rm(tempDir, { recursive: true, force: true })
  })

  it('provides ctx.artifacts across workflow steps', async () => {
    const result = await runHarness({
      name: 'artifacts-pipeline',
      steps: [
        {
          id: 'step-1-produce',
          run: async (ctx) => {
            await ctx.artifacts.put('reports/metrics.json', JSON.stringify({ cpu: 12, memory: 45 }))
            return 'produced'
          },
        },
        {
          id: 'step-2-consume',
          run: async (ctx) => {
            expect(await ctx.artifacts.has('reports/metrics.json')).toBe(true)
            const raw = await ctx.artifacts.get('reports/metrics.json')
            expect(raw).toContain('"cpu":12')
            const parsed = await ctx.artifacts.getJson<{ cpu: number }>('reports/metrics.json')
            expect(parsed?.cpu).toBe(12)
            return 'consumed'
          },
        },
      ],
    }, { workspaceDir: tempDir })

    expect(result.status).toBe('passed')
  })
})

describe('runHarness agent MCP server tool invocation', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ludd-harness-mcp-test-'))
  })

  afterEach(async () => {
    await fs.promises.rm(tempDir, { recursive: true, force: true })
  })

  it('injects mcpServerUrl and mcpAuthToken into AgentTurnInput for tool calls', async () => {
    let capturedMcpUrl = ''
    let capturedAuthToken = ''

    const agent: AgentRunner<string> = {
      __kind: 'agent',
      mode: 'workspace-write',
      prompt: 'store an artifact',
      executeTurn: async (input: AgentTurnInput) => {
        capturedMcpUrl = input.mcpServerUrl
        capturedAuthToken = input.mcpAuthToken
        expect(input.mcpServerUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/)
        expect(input.mcpAuthToken).toHaveLength(64)
        await callPutArtifact(input.mcpServerUrl, input.mcpAuthToken, 'agent-output.md', '# Summary by agent')
        return { output: 'artifact-stored', sessionId: input.sessionId }
      },
    }

    const result = await runHarness({
      name: 'agent-mcp-workflow',
      steps: [
        { id: 'agent-step', run: agent },
        {
          id: 'verify-step',
          run: async (ctx) => {
            const content = await ctx.artifacts.get('agent-output.md')
            expect(content).toBe('# Summary by agent')
            return 'verified'
          },
        },
      ],
    }, { workspaceDir: tempDir })

    expect(result.status).toBe('passed')
    await expect(fetch(capturedMcpUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${capturedAuthToken}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    })).rejects.toThrow()
  })
})

describe('runHarness agent MCP server lifecycle on failure', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ludd-harness-mcp-test-'))
  })

  afterEach(async () => {
    await fs.promises.rm(tempDir, { recursive: true, force: true })
  })

  it('closes embedded MCP server when a workflow step fails', async () => {
    let serverUrl = ''
    let serverToken = ''

    const agent: AgentRunner<string> = {
      __kind: 'agent',
      mode: 'read-only',
      prompt: 'failing turn',
      executeTurn: async (input: AgentTurnInput) => {
        serverUrl = input.mcpServerUrl
        serverToken = input.mcpAuthToken
        throw new Error('agent crashed during turn')
      },
    }

    const result = await runHarness({
      name: 'failing-workflow',
      steps: [
        { id: 'failing-step', run: agent },
      ],
    }, { workspaceDir: tempDir })

    expect(result.status).toBe('failed')
    await expect(fetch(serverUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${serverToken}` },
    })).rejects.toThrow()
  })
})
