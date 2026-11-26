import fs from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { readStreamEvents } from '@luddjs/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { acpAgent } from '../acp-agent.js'
import { createSessionUpdateCollector } from '../acp-stream.js'
import { FAKE_ACP_SERVER, makeTurnInput } from './helpers.js'

describe('acpAgent streaming session updates', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'ludd-acp-stream-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('forwards agent_thought_chunk, tool_call, tool_call_update, and agent_message_chunk to stream writer', async () => {
    const agent = acpAgent<string>({
      command: process.execPath,
      args: [FAKE_ACP_SERVER],
      env: { FAKE_ACP_INCLUDE_NON_TEXT: '1' },
    })

    const result = await agent.executeTurn(makeTurnInput(dir))
    expect(result.output).toBe('Hello world!')

    const events = readStreamEvents(dir, result.sessionId)
    expect(events.map(e => e.eventType)).toEqual([
      'thought',
      'tool_call',
      'tool_call',
      'tool_call',
      'message_chunk',
      'message_chunk',
    ])
    expect(events[0]?.payload).toEqual({ text: 'thinking step' })
    expect(events[1]?.payload).toMatchObject({
      phase: 'start',
      toolCallId: 'tc-1',
      toolName: 'read_file',
      title: 'Read file',
      kind: 'read',
      status: 'pending',
    })
    expect(events[2]?.payload).toMatchObject({
      phase: 'update',
      toolCallId: 'tc-1',
      status: 'in_progress',
    })
    expect(events[3]?.payload).toMatchObject({
      phase: 'end',
      toolCallId: 'tc-1',
      status: 'completed',
      rawOutput: { bytes: 42 },
    })
    expect(events[4]?.payload).toEqual({ text: 'Hello ' })
    expect(events[5]?.payload).toEqual({ text: 'world!' })
  })

  it('handles failed tool updates and fallback toolName when name is omitted', () => {
    const collector = createSessionUpdateCollector(makeTurnInput(dir))
    collector.onNotification({
      sessionId: 's-unit',
      update: {
        sessionUpdate: 'tool_call',
        toolCallId: 'tc-a',
        title: 'Run fallback',
      },
    })
    collector.onNotification({
      sessionId: 's-unit',
      update: {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'tc-a',
        name: 'bash',
        status: 'failed',
      },
    })

    const events = readStreamEvents(dir, 's-unit')
    expect(events).toHaveLength(2)
    expect(events[0]?.payload).toMatchObject({ phase: 'start', toolName: 'Run fallback' })
    expect(events[1]?.payload).toMatchObject({ phase: 'end', toolName: 'bash', status: 'failed' })
  })

  it('sanitizes untrusted notification.sessionId before writing stream files inside runDir/streams', () => {
    const collector = createSessionUpdateCollector(makeTurnInput(dir, { sessionId: 'safe-fallback' }))

    collector.onNotification({
      sessionId: '../escape/attempt',
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'escaped?' },
      },
    })
    collector.onNotification({
      sessionId: '..',
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'fallback' },
      },
    })

    const sanitizedEvents = readStreamEvents(dir, '.._escape_attempt')
    expect(sanitizedEvents).toHaveLength(1)
    expect(sanitizedEvents[0]?.sessionId).toBe('../escape/attempt')
    expect(fs.existsSync(path.join(dir, 'escape'))).toBe(false)

    const fallbackEvents = readStreamEvents(dir, 'safe-fallback')
    expect(fallbackEvents).toHaveLength(1)
    expect(fallbackEvents[0]?.sessionId).toBe('..')
  })
})
