import type { RunUiEntry } from '../ui/run-ui-bridge.js'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { registerRunUiHost } from '../ui/run-ui-bridge.js'
import { LiveRunTailer } from './live-run-tailer.js'

const directories: string[] = []
function setup(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ludd-tailer-ui-'))
  directories.push(dir)
  return dir
}

afterEach(() => {
  vi.useRealTimers()
  for (const dir of directories.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

it('dispatches formatted ledger and stream events to the registered RunUiHost', async () => {
  vi.useFakeTimers()
  const dir = setup()
  const streams = path.join(dir, 'streams')
  fs.mkdirSync(streams)
  const entries: RunUiEntry[] = []
  const activities: Array<string | undefined> = []
  const unregister = registerRunUiHost({
    pushEntry: e => entries.push(e),
    setActivity: a => activities.push(a),
  })

  try {
    fs.writeFileSync(path.join(dir, 'ledger.jsonl'), [
      JSON.stringify({
        eventType: 'run.started',
        payload: { harnessName: 'demo' },
      }),
      JSON.stringify({ eventType: 'run.resumed', payload: {} }),
      JSON.stringify({ eventType: 'step.started', stepId: 's1' }),
      JSON.stringify({
        eventType: 'agent.stream.linked',
        stepId: 's1',
        payload: { sessionId: 'sess-1' },
      }),
      JSON.stringify({ eventType: 'guardrail.started', stepId: 's1' }),
      JSON.stringify({
        eventType: 'guardrail.started',
        stepId: 's1',
        payload: { guardrailName: 'typecheck' },
      }),
      JSON.stringify({ eventType: 'gate.waiting', stepId: 's1' }),
      JSON.stringify({ eventType: 'gate.resolved', stepId: 's1' }),
      JSON.stringify({ eventType: 'guardrail.failed', stepId: 's1' }),
      JSON.stringify({
        eventType: 'guardrail.failed',
        stepId: 's1',
        payload: { guardrailName: 'lint' },
      }),
      JSON.stringify({
        eventType: 'step.retry',
        stepId: 's1',
        payload: { attempt: 2 },
      }),
      JSON.stringify({ eventType: 'step.retry', stepId: 's1', payload: {} }),
      JSON.stringify({ eventType: 'guardrail.passed', stepId: 's1' }),
      JSON.stringify({
        eventType: 'guardrail.passed',
        stepId: 's1',
        payload: { guardrailName: 'typecheck' },
      }),
      JSON.stringify({ eventType: 'guardrail.skipped', stepId: 's1' }),
      JSON.stringify({
        eventType: 'guardrail.skipped',
        stepId: 's1',
        payload: { guardrailName: 'e2e' },
      }),
      JSON.stringify({ eventType: 'step.skipped', stepId: 's2' }),
      JSON.stringify({ eventType: 'step.passed', stepId: 's1' }),
      JSON.stringify({
        eventType: 'step.failed',
        stepId: 's3',
        payload: { error: 'err' },
      }),
      JSON.stringify({
        eventType: 'run.failed',
        payload: { error: 'err' },
      }),
      JSON.stringify({ eventType: 'run.passed', payload: {} }),
      JSON.stringify({ eventType: 'run.started' }),
      JSON.stringify({}),
      '',
    ].join('\n'))

    fs.writeFileSync(path.join(streams, 'sess-1.jsonl'), [
      JSON.stringify({ eventType: 'turn.started', stepId: 's1', payload: {} }),
      JSON.stringify({
        eventType: 'message_chunk',
        stepId: 's1',
        payload: { text: 'Hello ' },
      }),
      JSON.stringify({
        eventType: 'message_chunk',
        stepId: 's1',
        payload: { text: 'world' },
      }),
      JSON.stringify({
        eventType: 'tool_call',
        stepId: 's1',
        payload: {
          phase: 'start',
          toolName: 'ask_user',
          args: { prompt: 'Q?' },
        },
      }),
      JSON.stringify({
        eventType: 'tool_call',
        stepId: 's1',
        payload: {
          phase: 'start',
          toolName: 'read_log_page',
          args: { logKey: 'k1' },
        },
      }),
      JSON.stringify({
        eventType: 'tool_call',
        stepId: 's1',
        payload: { phase: 'update', toolName: 'read_log_page' },
      }),
      JSON.stringify({
        eventType: 'tool_call',
        stepId: 's1',
        payload: { phase: 'end', toolName: 'read_log_page', isError: false },
      }),
      JSON.stringify({
        eventType: 'tool_call',
        payload: { phase: 'end', isError: true },
      }),
      JSON.stringify({
        eventType: 'turn.completed',
        stepId: 's1',
        payload: {
          output: { guess: 2 },
        },
      }),
      JSON.stringify({
        eventType: 'turn.completed',
        stepId: 's1',
        payload: { output: 'Hello world' },
      }),
      JSON.stringify({
        eventType: 'turn.completed',
        stepId: 's1',
        payload: {},
      }),
      JSON.stringify({
        eventType: 'thought',
        stepId: 's1',
        payload: { text: 'internal' },
      }),
      JSON.stringify({ eventType: 'turn.started', stepId: 's1' }),
      JSON.stringify({
        eventType: 'message_chunk',
        stepId: 's1',
        payload: { text: 'Trailing text' },
      }),
      '',
    ].join('\n'))

    const tailer = new LiveRunTailer(dir, false)
    tailer.start()
    await vi.advanceTimersByTimeAsync(100)
    tailer.stop()

    expect(entries).toEqual(expect.arrayContaining([
      { kind: 'run.started', harnessName: 'demo' },
      { kind: 'run.started', harnessName: 'ludd' },
      { kind: 'run.resumed', harnessName: undefined },
      { kind: 'step.started', stepId: 's1' },
      { kind: 'guardrail.failed' },
      { kind: 'guardrail.failed', name: 'lint' },
      { kind: 'step.retry', stepId: 's1', attempt: 2 },
      { kind: 'step.retry', stepId: 's1', attempt: undefined },
      { kind: 'guardrail.passed' },
      { kind: 'guardrail.passed', name: 'typecheck' },
      { kind: 'guardrail.skipped' },
      { kind: 'guardrail.skipped', name: 'e2e' },
      { kind: 'step.skipped', stepId: 's2' },
      { kind: 'step.passed', stepId: 's1' },
      { kind: 'step.failed', stepId: 's3', error: 'err' },
      { kind: 'run.failed', error: 'err' },
      { kind: 'run.passed' },
      { kind: 'agent.text', text: 'Hello world' },
      { kind: 'tool.start', toolName: 'read_log_page', argsSummary: 'logKey=k1' },
      { kind: 'tool.error', toolName: 'tool' },
      { kind: 'agent.output', output: '{"guess":2}' },
      { kind: 'agent.text', text: 'Trailing text' },
    ]))
    expect(entries.some(e => e.kind === 'tool.start' && e.toolName === 'ask_user')).toBe(false)
    expect(activities).toContain('s1 · running...')
    expect(activities).toContain('s1 · thinking...')
    expect(activities).toContain('s1 · running read_log_page...')
    expect(activities).toContain('s1 · running guardrail...')
    expect(activities).toContain('s1 · running guardrail typecheck...')
    expect(activities.at(-1)).toBeUndefined()
  }
  finally {
    unregister()
  }
})
