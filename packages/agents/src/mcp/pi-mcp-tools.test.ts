import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { startEmbeddedMcpServer } from '@ludd/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import {
  BRIDGE_TOOL_NAMES,
  createMcpBridgeTools,
  createSubmitStepOutputTool,
  MISSING_SUBMISSION_ISSUE,
} from './pi-mcp-tools.js'

type Exec = (id: string, params: unknown, signal?: AbortSignal) => Promise<{ content: Array<{ text: string }> }>

function exec(tool: unknown): Exec {
  return (tool as { execute: Exec }).execute
}

describe('createMcpBridgeTools (real embedded server)', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'ludd-bridge-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('exposes every server tool and round-trips artifacts with the bearer token', async () => {
    const server = await startEmbeddedMcpServer(dir)
    try {
      const tools = createMcpBridgeTools({ url: server.url, authToken: server.authToken })
      expect(tools.map(t => t.name)).toEqual(expect.arrayContaining([
        'put_artifact',
        'get_artifact',
        'list_artifacts',
        'read_log_page',
        'read_log_lines',
        'search_log',
      ]))
      const byName = (n: string): unknown => tools.find(t => t.name === n)
      await exec(byName('put_artifact'))('1', { key: 'spec.md', content: '# spec' })
      const got = await exec(byName('get_artifact'))('2', { key: 'spec.md' })
      expect(got.content[0]?.text).toBe('# spec')
      const ac = new AbortController()
      await expect(exec(byName('get_artifact'))('3', { key: 'nope.md' }, ac.signal)).rejects.toThrow('not found')
    }
    finally {
      await server.close()
    }
  })

  it('fails on a wrong token (HTTP 401)', async () => {
    const server = await startEmbeddedMcpServer(dir)
    try {
      const [tool] = createMcpBridgeTools({ url: server.url, authToken: 'wrong' })
      await expect(exec(tool)('1', {})).rejects.toThrow('HTTP 401')
    }
    finally {
      await server.close()
    }
  })
})

describe('createMcpBridgeTools (stubbed fetch)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function stub(body: unknown): void {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => body,
    })))
  }

  it('surfaces JSON-RPC errors with and without message', async () => {
    const [tool] = createMcpBridgeTools({ url: 'http://x', authToken: 't' })
    stub({
      error: { message: 'boom' },
    })
    await expect(exec(tool)('1', {})).rejects.toThrow('boom')
    stub({ error: {} })
    await expect(exec(tool)('1', {})).rejects.toThrow('MCP request failed')
  })

  it('tolerates results without content or text parts', async () => {
    const [tool] = createMcpBridgeTools({ url: 'http://x', authToken: 't' })
    stub({ result: {} })
    expect((await exec(tool)('1', {})).content[0]?.text).toBe('')
    stub({
      result: {
        content: [
          { type: 'image' },
        ],
      },
    })
    expect((await exec(tool)('1', {})).content[0]?.text).toBe('')
  })
})

describe('createSubmitStepOutputTool', () => {
  const schema = z.object({
    status: z.enum(['ok', 'bad']),
    nested: z.object({
      n: z.number(),
    }).optional(),
  })

  it('derives parameters from the zod schema without $schema', () => {
    const { tool } = createSubmitStepOutputTool(schema)
    expect(tool.name).toBe('submit_step_output')
    expect(tool.parameters).toMatchObject({
      type: 'object',
      properties: {
        status: expect.anything(),
      },
    })
    expect(tool.parameters).not.toHaveProperty('$schema')
  })

  it('returns zod issues as a tool error for invalid payloads and captures valid ones', async () => {
    const { tool, getSubmission } = createSubmitStepOutputTool(schema)
    expect(getSubmission()).toBeUndefined()
    await expect(exec(tool)('1', { status: 'nope' })).rejects.toThrow(/Output validation failed:\nstatus:/)
    await expect(exec(tool)('1', {})).rejects.toThrow('status:')
    await expect(exec(tool)('1', {
      status: 'ok',
      nested: { n: 'x' },
    })).rejects.toThrow('nested.n:')
    expect(getSubmission()).toBeUndefined()
    await exec(tool)('1', { status: 'ok' })
    expect(getSubmission()).toEqual({
      value: { status: 'ok' },
    })
  })

  it('reports root-level issues as <root>', async () => {
    const { tool } = createSubmitStepOutputTool(z.object({}).refine(() => false, 'never'))
    await expect(exec(tool)('1', {})).rejects.toThrow('<root>: never')
  })
})

describe('createSubmitStepOutputTool edge cases', () => {
  it('wraps non-object schemas under a value key', async () => {
    const { tool, getSubmission } = createSubmitStepOutputTool(z.string())
    expect(tool.parameters).toMatchObject({
      type: 'object',
      required: ['value'],
    })
    await expect(exec(tool)('1', { value: 3 })).rejects.toThrow('validation failed')
    await exec(tool)('1', { value: 'hi' })
    expect(getSubmission()).toEqual({ value: 'hi' })
  })

  it('exports bridge names and a missing-submission issue', () => {
    expect(BRIDGE_TOOL_NAMES).toContain('submit_step_output')
    expect(BRIDGE_TOOL_NAMES).toContain('put_artifact')
    expect(MISSING_SUBMISSION_ISSUE.message).toContain('submit_step_output')
  })
})
