import type { ArtifactClient, RunStateSnapshot, StepConfig, StepContext } from '@luddjs/core'
import fs from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { executeAgentStep } from '@luddjs/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { acpAgent } from '../acp-agent.js'
import { FAKE_ACP_SERVER } from './helpers.js'

interface LoggedRequest {
  method: string
  params: Record<string, unknown>
}

function readLoggedRequests(logFile: string): LoggedRequest[] {
  return fs
    .readFileSync(logFile, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line) as LoggedRequest)
}

function createCoreContext(): StepContext {
  return {
    runId: 'run-acp-resume-1',
    steps: {},
    step: { id: 'step-resume', output: undefined, attempt: 1 },
    matrix: undefined,
    artifacts: {} as ArtifactClient,
  }
}

function createCoreSnapshot(stepId: string): RunStateSnapshot {
  return {
    schemaVersion: 1,
    runId: 'run-acp-resume-1',
    harnessName: 'acp-resume-harness',
    workflowName: 'acp-resume-harness',
    status: 'running',
    activeStepId: stepId,
    activeSessionId: null,
    activeStepAttempt: 1,
    steps: {},
    updatedAt: new Date().toISOString(),
  }
}

describe('acpAgent session resumption with executeAgentStep retries', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'ludd-acp-resume-core-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('uses session/new on fresh attempt 1 and session/load on retry', async () => {
    const logFile = path.join(dir, 'exec-step-retry.jsonl')
    const stateFile = path.join(dir, 'fake-state.json')
    const schema = z.object({
      ok: z.literal(true),
    })

    const agent = acpAgent<{ ok: true }>({
      command: process.execPath,
      args: [FAKE_ACP_SERVER],
      env: {
        FAKE_ACP_REQUEST_LOG_FILE: logFile,
        FAKE_ACP_STATE_FILE: stateFile,
        FAKE_ACP_REQUIRE_KNOWN_SESSION: '1',
        FAKE_ACP_SCENARIO: 'retry-json',
      },
      prompt: 'return ok true',
    })
    const step: StepConfig = { id: 'step-resume', run: agent, outputSchema: schema }
    const snapshot = createCoreSnapshot('step-resume')

    const output = await executeAgentStep(
      step,
      agent,
      createCoreContext(),
      snapshot,
      dir,
      undefined,
      undefined,
      { cwd: dir, env: {} },
    )

    expect(output).toEqual({ ok: true, sessionId: 'fake-session-1' })
    expect(snapshot.activeSessionId).toBe('fake-session-1')

    const requests = readLoggedRequests(logFile)
    expect(requests.map(r => r.method)).toEqual([
      'initialize',
      'session/new',
      'session/prompt',
      'initialize',
      'session/load',
      'session/prompt',
    ])
    expect(requests[4]?.params.sessionId).toBe('fake-session-1')
    expect(requests[5]?.params.sessionId).toBe('fake-session-1')
  })

  it('tracks returned sessionId cleanly across retries when loadSession is false', async () => {
    const logFile = path.join(dir, 'exec-step-no-load.jsonl')
    const stateFile = path.join(dir, 'fake-state-no-load.json')
    await writeFile(stateFile, JSON.stringify({ sessionCounter: 0, promptCount: 0, sessionIds: [] }), 'utf8')
    const schema = z.object({
      ok: z.literal(true),
    })

    const agent = acpAgent<{ ok: true }>({
      command: process.execPath,
      args: [FAKE_ACP_SERVER],
      env: {
        FAKE_ACP_REQUEST_LOG_FILE: logFile,
        FAKE_ACP_STATE_FILE: stateFile,
        FAKE_ACP_LOAD_SESSION: 'false',
        FAKE_ACP_SCENARIO: 'retry-json',
      },
      prompt: 'return ok true',
    })
    const step: StepConfig = { id: 'step-no-load', run: agent, outputSchema: schema }
    const snapshot = createCoreSnapshot('step-no-load')

    const output = await executeAgentStep(
      step,
      agent,
      createCoreContext(),
      snapshot,
      dir,
      undefined,
      undefined,
      { cwd: dir, env: {} },
    )

    expect(output).toEqual({ ok: true, sessionId: 'fake-session-2' })
    expect(snapshot.activeSessionId).toBe('fake-session-2')

    const requests = readLoggedRequests(logFile)
    expect(requests.map(r => r.method)).toEqual([
      'initialize',
      'session/new',
      'session/prompt',
      'initialize',
      'session/new',
      'session/prompt',
    ])
  })
})
