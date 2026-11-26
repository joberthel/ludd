import fs from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { readStreamEvents } from '@luddjs/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { acpAgent } from '../acp-agent.js'
import { FAKE_ACP_SERVER, makeTurnInput } from './helpers.js'

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

describe('acpAgent capability-driven session resumption', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'ludd-acp-resume-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('calls session/new on a fresh turn and returns the ACP sessionId', async () => {
    const logFile = path.join(dir, 'requests.jsonl')
    const agent = acpAgent<string>({
      command: process.execPath,
      args: [FAKE_ACP_SERVER],
      env: { FAKE_ACP_REQUEST_LOG_FILE: logFile },
    })

    const result = await agent.executeTurn(makeTurnInput(dir))
    expect(result.output).toBe('Hello world!')
    expect(result.sessionId).toBe('fake-session-1')

    const requests = readLoggedRequests(logFile)
    expect(requests.map(r => r.method)).toEqual([
      'initialize',
      'session/new',
      'session/prompt',
    ])
    expect(requests[2]?.params.sessionId).toBe('fake-session-1')
  })

  it('invokes session/load when loadSession is true and config.sessionId is supplied', async () => {
    const logFile = path.join(dir, 'load-config.jsonl')
    const agent = acpAgent<string>({
      command: process.execPath,
      args: [FAKE_ACP_SERVER],
      sessionId: () => 'prior-acp-session-42',
      env: {
        FAKE_ACP_REQUEST_LOG_FILE: logFile,
        FAKE_ACP_SEED_SESSION_ID: 'prior-acp-session-42',
        FAKE_ACP_REQUIRE_KNOWN_SESSION: '1',
      },
    })

    const result = await agent.executeTurn(makeTurnInput(dir, {
      mcp: {
        url: 'http://127.0.0.1:4321/mcp',
        authToken: 'tok-resume',
      },
    }))

    expect(result.output).toBe('Hello world!')
    expect(result.sessionId).toBe('prior-acp-session-42')

    const requests = readLoggedRequests(logFile)
    expect(requests.map(r => r.method)).toEqual([
      'initialize',
      'session/load',
      'session/prompt',
    ])
    expect(requests[1]?.params).toMatchObject({
      sessionId: 'prior-acp-session-42',
      cwd: dir,
      mcpServers: [
        expect.objectContaining({ name: 'ludd' }),
      ],
    })
    expect(requests[2]?.params.sessionId).toBe('prior-acp-session-42')
  })

  it('ignores replayed history notifications during session/load and only collects current prompt output', async () => {
    const logFile = path.join(dir, 'load-replay.jsonl')
    const agent = acpAgent<string>({
      command: process.execPath,
      args: [FAKE_ACP_SERVER],
      env: {
        FAKE_ACP_REQUEST_LOG_FILE: logFile,
        FAKE_ACP_LOAD_REPLAY: '[replayed-from-history]',
        FAKE_ACP_SCENARIO: 'response',
        FAKE_ACP_RESPONSE: 'fresh-turn-answer',
      },
    })

    const result = await agent.executeTurn(makeTurnInput(dir, {
      previousSessionId: 'resumed-sess-99',
    }))

    expect(result.sessionId).toBe('resumed-sess-99')
    expect(result.output).toBe('fresh-turn-answer')

    const requests = readLoggedRequests(logFile)
    expect(requests.map(r => r.method)).toEqual([
      'initialize',
      'session/load',
      'session/prompt',
    ])

    const streamEvents = readStreamEvents(dir, 'resumed-sess-99')
    expect(streamEvents.map(e => e.payload)).toEqual([
      { text: 'fresh-turn-answer' },
    ])
  })

  it('calls session/new without synthetic fallback when loadSession is false or absent', async () => {
    for (const loadMode of ['false', 'omit', 'omit-capabilities']) {
      const logFile = path.join(dir, `no-load-${loadMode}.jsonl`)
      const agent = acpAgent<string>({
        command: process.execPath,
        args: [FAKE_ACP_SERVER],
        sessionId: 'requested-prior-session',
        env: {
          FAKE_ACP_REQUEST_LOG_FILE: logFile,
          FAKE_ACP_LOAD_SESSION: loadMode,
          FAKE_ACP_SCENARIO: 'echo-prompt',
        },
      })

      const result = await agent.executeTurn(makeTurnInput(dir, {
        prompt: 'clean prompt without synthetic history',
      }))

      expect(result.sessionId).toBe('fake-session-1')
      expect(result.output).toBe('clean prompt without synthetic history')

      const requests = readLoggedRequests(logFile)
      expect(requests.map(r => r.method)).toEqual([
        'initialize',
        'session/new',
        'session/prompt',
      ])
    }
  })

  it('treats whitespace previousSessionId and config.sessionId as absent and starts a fresh session', async () => {
    const logFile = path.join(dir, 'whitespace.jsonl')
    const agent = acpAgent<string>({
      command: process.execPath,
      args: [FAKE_ACP_SERVER],
      sessionId: '   ',
      env: { FAKE_ACP_REQUEST_LOG_FILE: logFile },
    })

    const result = await agent.executeTurn(makeTurnInput(dir, {
      previousSessionId: '   ',
    }))

    expect(result.sessionId).toBe('fake-session-1')
    const requests = readLoggedRequests(logFile)
    expect(requests.map(r => r.method)).toEqual([
      'initialize',
      'session/new',
      'session/prompt',
    ])
  })
})
