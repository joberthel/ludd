import type { AgentRunner, AgentTurnInput } from '../../types/agent.js'
import type { Guardrail } from '../../types/guardrail.js'
import fs from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readRunState, resolveRunDir } from '../../persistence/state-store.js'
import { runHarness } from '../run-harness.js'

let tempDir: string

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-logs-test-'))
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

async function callMcpTool(
  url: string,
  token: string,
  name: string,
  args: Record<string, unknown>,
): Promise<any> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  })
  return res.json()
}

function make10kLines(): string {
  return Array.from({ length: 10000 }, (_, i) => {
    if (i === 5432) {
      return 'ERROR: assertion failed at index 5432'
    }
    return `log output line ${i}`
  }).join('\n')
}

async function queryMcpLogs(input: AgentTurnInput): Promise<{ page: any, lines: any, search: any }> {
  const page = await callMcpTool(input.mcpServerUrl, input.mcpAuthToken, 'read_log_page', {
    logKey: 's1-1-afterStep-0',
    page: 1,
    pageSize: 50,
  })
  const lines = await callMcpTool(input.mcpServerUrl, input.mcpAuthToken, 'read_log_lines', {
    logKey: 's1-1-afterStep-0',
    startLine: 5430,
    endLine: 5435,
  })
  const search = await callMcpTool(input.mcpServerUrl, input.mcpAuthToken, 'search_log', {
    logKey: 's1-1-afterStep-0',
    query: 'assertion failed',
  })
  return { page, lines, search }
}

function verifyMcpLogResults(page: any, lines: any, search: any): void {
  const parsedPage = JSON.parse(page.result.content[0].text)
  expect(parsedPage.lines).toHaveLength(50)
  expect(parsedPage.totalPages).toBe(200)

  const parsedLines = JSON.parse(lines.result.content[0].text)
  expect(parsedLines.lines).toHaveLength(6)
  expect(parsedLines.lines[3]).toBe('ERROR: assertion failed at index 5432')

  const parsedSearch = JSON.parse(search.result.content[0].text)
  expect(parsedSearch.matches).toHaveLength(1)
  expect(parsedSearch.matches[0].lineNumber).toBe(5433)
}

function makeFailingRail(lines10k: string): Guardrail {
  return {
    __kind: 'guardrail',
    type: 'exec',
    maxRetries: 2,
    execute: async (input) => {
      if (input.attempt === 1) {
        return { status: 'fail', body: 'Test suite failed', rawLog: lines10k }
      }
      return { status: 'pass' }
    },
  }
}

describe('afterStep 10k failure log offload and MCP pagination (AC 5.3.1 & 5.3.2)', () => {
  it('offloads 10k lines, sends concise prompt, and serves bounded lines over MCP', async () => {
    let capturedPrompt = ''
    let mcpResponses: { page: any, lines: any, search: any } | undefined
    const lines10k = make10kLines()

    const agent: AgentRunner<{ ok: boolean }> = {
      __kind: 'agent',
      mode: 'workspace-write',
      prompt: 'Produce build output',
      executeTurn: async (input: AgentTurnInput) => {
        if (input.attempt === 2) {
          capturedPrompt = input.prompt
          mcpResponses = await queryMcpLogs(input)
        }
        return {
          output: { ok: true },
          sessionId: input.sessionId,
        }
      },
    }

    const result = await runHarness({
      name: 'log-offload-test',
      steps: [
        {
          id: 's1',
          run: agent,
          afterStep: [
            makeFailingRail(lines10k),
          ],
        },
      ],
    }, { workspaceDir: tempDir })

    expect(result.status).toBe('passed')
    expect(capturedPrompt).toContain('The step failed afterStep guardrail #0.')
    expect(capturedPrompt).toContain('Detailed failure log has been offloaded to MCP logKey "s1-1-afterStep-0"')
    expect(capturedPrompt).toContain('read_log_page, read_log_lines, search_log')
    expect(capturedPrompt).not.toContain('log output line 100')
    expect(capturedPrompt.length).toBeLessThan(600)

    const runDir = resolveRunDir(tempDir, result.runId)
    const logPath = path.join(runDir, 'logs', 's1-1-afterStep-0.log')
    expect(fs.existsSync(logPath)).toBe(true)
    expect(fs.readFileSync(logPath, 'utf8')).toBe(lines10k)
    expect(readRunState(runDir).logs?.['s1-1-afterStep-0']?.totalLines).toBe(10000)

    verifyMcpLogResults(mcpResponses?.page, mcpResponses?.lines, mcpResponses?.search)
  })
})

function makeJsonRail(items: unknown[]): Guardrail {
  return {
    __kind: 'guardrail',
    type: 'exec',
    maxRetries: 2,
    execute: async (input) => {
      if (input.attempt === 1) {
        return {
          status: 'fail',
          logFormat: 'json',
          pagination: 'errors',
          body: { errors: items },
        }
      }
      return { status: 'pass' }
    },
  }
}

describe('structured JSON pagination over MCP (AC 5.3.3)', () => {
  it('serves paginated JSON array slices with totalItems and totalPages', async () => {
    let capturedPageResult: any
    const jsonItems = Array.from({ length: 15 }, (_, i) => ({ id: i + 1, code: `ERR_${i + 1}` }))

    const agent: AgentRunner<{ ok: boolean }> = {
      __kind: 'agent',
      mode: 'workspace-write',
      prompt: 'Fix json errors',
      executeTurn: async (input: AgentTurnInput) => {
        if (input.attempt === 2) {
          capturedPageResult = await callMcpTool(input.mcpServerUrl, input.mcpAuthToken, 'read_log_page', {
            logKey: 'json-step-1-afterStep-0',
            page: 2,
            pageSize: 5,
          })
        }
        return {
          output: { ok: true },
          sessionId: input.sessionId,
        }
      },
    }

    const result = await runHarness({
      name: 'json-pagination-test',
      steps: [
        {
          id: 'json-step',
          run: agent,
          afterStep: [
            makeJsonRail(jsonItems),
          ],
        },
      ],
    }, { workspaceDir: tempDir })

    expect(result.status).toBe('passed')
    const parsed = JSON.parse(capturedPageResult.result.content[0].text)
    expect(parsed.format).toBe('json')
    expect(parsed.page).toBe(2)
    expect(parsed.totalItems).toBe(15)
    expect(parsed.totalPages).toBe(3)
    expect(parsed.items).toHaveLength(5)
    expect(parsed.items[0]).toEqual({ id: 6, code: 'ERR_6' })
  })
})
