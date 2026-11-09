import type { AgentTurnInput, StepConfig, StepContext } from '../src/index.js'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { mockAgent } from '@ludd/agents'
import { hostEnv } from '@ludd/environments'
import { agentGuardrail, execGuardrail } from '@ludd/guardrails'
import { expect } from 'vitest'
import { z } from 'zod'
import { readLedgerEvents, readRunState } from '../src/index.js'
import { writeStatus } from './epic-05-scripts.js'

export { setupSimulatedCommands, writeStatus } from './epic-05-scripts.js'

export interface CapturedMcpData {
  turn2PageLines?: string[]
  turn2SearchMatches?: unknown[]
  turn3JsonItems?: unknown[]
}

export interface McpToolResult {
  result: {
    content: Array<{ type: string, text: string }>
  }
}

export async function callMcpTool(
  url: string,
  token: string,
  name: string,
  args: Record<string, unknown>,
): Promise<McpToolResult> {
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
  return (await res.json()) as McpToolResult
}

async function executeTurn2(
  input: AgentTurnInput,
  dir: string,
  captured: CapturedMcpData,
): Promise<{ commitMessage: string }> {
  const pageRes = await callMcpTool(input.mcpServerUrl, input.mcpAuthToken, 'read_log_page', {
    logKey: 'implement-slices-1',
    page: 1,
    pageSize: 5,
  })
  const searchRes = await callMcpTool(input.mcpServerUrl, input.mcpAuthToken, 'search_log', {
    logKey: 'implement-slices-1',
    query: 'FAILURES',
  })
  const parsedPage = JSON.parse(pageRes.result.content[0].text) as { lines: string[] }
  const parsedSearch = JSON.parse(searchRes.result.content[0].text) as { matches: unknown[] }
  captured.turn2PageLines = parsedPage.lines
  captured.turn2SearchMatches = parsedSearch.matches
  writeStatus(dir, { phpstan: 'fail', phpunit: 'ok' })
  return { commitMessage: 'fix(auth): fix phpunit but break phpstan' }
}

async function executeTurn3(
  input: AgentTurnInput,
  dir: string,
  captured: CapturedMcpData,
): Promise<{ commitMessage: string }> {
  const jsonRes = await callMcpTool(input.mcpServerUrl, input.mcpAuthToken, 'read_log_page', {
    logKey: 'implement-slices-2',
    page: 1,
    pageSize: 5,
  })
  const parsedJson = JSON.parse(jsonRes.result.content[0].text) as { items: unknown[] }
  captured.turn3JsonItems = parsedJson.items
  writeStatus(dir, { phpstan: 'ok', phpunit: 'ok' })
  return { commitMessage: 'fix(auth): fix phpstan regression' }
}

function createSliceAgent(dir: string, captured: CapturedMcpData) {
  return mockAgent({
    mode: 'workspace-write',
    prompt: 'Implement auth slice',
    responses: [
      {
        commitMessage: 'feat(auth): initial slice 1',
      },
      async input => executeTurn2(input, dir, captured),
      async input => executeTurn3(input, dir, captured),
      {
        commitMessage: 'feat(auth): complete slice with clean review',
      },
    ],
  })
}

function createReviewAgent() {
  return mockAgent({
    mode: 'read-only',
    prompt: 'Review slice diff',
    responses: [
      {
        status: 'fail',
        body: {
          findings: ['Security violation: SQL injection vulnerability detected'],
        },
      },
      {
        status: 'pass',
        body: { findings: [] },
      },
    ],
  })
}

function buildImplementGuardrails(dir: string) {
  return [
    execGuardrail({
      command: [
        process.execPath,
        path.join(dir, 'phpstan.cjs'),
      ],
      maxRetries: 3,
      pagination: 'errors',
    }),
    execGuardrail({
      command: [
        process.execPath,
        path.join(dir, 'phpunit.cjs'),
      ],
      maxRetries: 3,
    }),
    agentGuardrail({
      mode: 'read-only',
      maxRetries: 2,
      bodySchema: z.object({
        findings: z.array(z.string()),
      }),
      prompt: 'Review slice diff for violations',
      agent: createReviewAgent(),
    }),
    execGuardrail({
      command: (ctx: StepContext) => {
        const output = ctx.step.output as { commitMessage: string }
        return [
          process.execPath,
          path.join(dir, 'commit.cjs'),
          output.commitMessage,
        ]
      },
      maxRetries: 1,
    }),
  ]
}

export function buildImplementStep(dir: string, captured: CapturedMcpData): StepConfig {
  return {
    id: 'implement-slices',
    matrix: {
      items: [
        { id: 'slice-1', title: 'User authentication slice' },
      ],
    },
    outputSchema: z.object({
      commitMessage: z.string().min(5),
    }),
    maxTotalTurns: 10,
    run: createSliceAgent(dir, captured),
    afterStep: buildImplementGuardrails(dir),
  }
}

export function buildReviewStep(dir: string): StepConfig {
  return {
    id: 'final-review-and-pr',
    if: (ctx: StepContext) => ctx.steps['implement-slices']?.status === 'passed',
    artifacts: {
      'pr-description.md': { nonEmpty: true },
    },
    beforeStep: [
      execGuardrail({
        command: [
          process.execPath,
          path.join(dir, 'git-status.cjs'),
        ],
      }),
      execGuardrail({
        command: [
          process.execPath,
          path.join(dir, 'git-log.cjs'),
        ],
      }),
    ],
    run: mockAgent({
      mode: 'read-only',
      prompt: 'Generate PR description',
      responses: [
        async (input) => {
          await callMcpTool(input.mcpServerUrl, input.mcpAuthToken, 'put_artifact', {
            key: 'pr-description.md',
            content: '# Pull Request\n\nAuth slice implemented and verified.',
          })
          return { prCreated: true }
        },
      ],
    }),
    afterStep: [
      execGuardrail({
        environment: hostEnv(),
        command: [
          process.execPath,
          path.join(dir, 'push-branch.cjs'),
        ],
      }),
    ],
  }
}

export function verifyEpic5Assertions(dir: string, runDir: string, captured: CapturedMcpData): void {
  expect(captured.turn2PageLines).toBeDefined()
  expect(captured.turn2PageLines?.some(l => l.includes('FAILURES'))).toBe(true)
  expect(captured.turn2SearchMatches?.length).toBeGreaterThanOrEqual(1)
  expect(captured.turn3JsonItems).toEqual([
    { message: 'Call to undefined method Auth::verify()', line: 15 },
  ])

  const commits = fs.readFileSync(path.join(dir, 'commits.log'), 'utf-8').trim().split('\n')
  expect(commits).toHaveLength(1)
  expect(commits[0]).toBe('feat(auth): complete slice with clean review')

  const pushLog = fs.readFileSync(path.join(dir, 'push.log'), 'utf-8').trim()
  expect(pushLog).toBe('pushed')

  const state = readRunState(runDir)
  expect(state.status).toBe('passed')
  expect(state.steps['implement-slices']?.status).toBe('passed')
  expect(state.steps['final-review-and-pr']?.status).toBe('passed')

  const ledger = readLedgerEvents(runDir)
  const rail3Started = ledger.filter(e => e.eventType === 'guardrail.started' && e.payload.guardrailIndex === 3)
  expect(rail3Started).toHaveLength(1)
  expect(rail3Started[0].payload.attempt).toBe(4)
}
