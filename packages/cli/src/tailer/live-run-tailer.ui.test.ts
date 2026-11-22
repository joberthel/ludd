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
      expect.objectContaining({ kind: 'run.started', harnessName: 'demo' }),
      expect.objectContaining({ kind: 'run.started', harnessName: 'ludd' }),
      expect.objectContaining({ kind: 'run.resumed', harnessName: undefined }),
      expect.objectContaining({
        kind: 'step.started',
        stepId: 's1',
        scope: { stepId: 's1' },
      }),
      expect.objectContaining({
        kind: 'guardrail.failed',
        scope: { stepId: 's1' },
      }),
      expect.objectContaining({
        kind: 'guardrail.failed',
        name: 'lint',
        scope: { stepId: 's1', guardrailName: 'lint' },
      }),
      expect.objectContaining({
        kind: 'step.retry',
        stepId: 's1',
        attempt: 2,
        scope: { stepId: 's1', phase: 'run', attempt: 2 },
      }),
      expect.objectContaining({
        kind: 'step.retry',
        stepId: 's1',
        attempt: undefined,
        scope: { stepId: 's1', phase: 'run' },
      }),
      expect.objectContaining({
        kind: 'guardrail.passed',
        scope: { stepId: 's1' },
      }),
      expect.objectContaining({
        kind: 'guardrail.passed',
        name: 'typecheck',
        scope: { stepId: 's1', guardrailName: 'typecheck' },
      }),
      expect.objectContaining({
        kind: 'guardrail.skipped',
        scope: { stepId: 's1' },
      }),
      expect.objectContaining({
        kind: 'guardrail.skipped',
        name: 'e2e',
        scope: { stepId: 's1', guardrailName: 'e2e' },
      }),
      expect.objectContaining({
        kind: 'step.skipped',
        stepId: 's2',
        scope: { stepId: 's2' },
      }),
      expect.objectContaining({
        kind: 'step.passed',
        stepId: 's1',
        scope: { stepId: 's1' },
      }),
      expect.objectContaining({
        kind: 'step.failed',
        stepId: 's3',
        error: 'err',
        scope: { stepId: 's3' },
      }),
      expect.objectContaining({ kind: 'run.failed', error: 'err' }),
      expect.objectContaining({ kind: 'run.passed' }),
      expect.objectContaining({
        kind: 'agent.text',
        text: 'Hello world',
        scope: { stepId: 's1', phase: 'run' },
      }),
      expect.objectContaining({
        kind: 'tool.start',
        toolName: 'read_log_page',
        argsSummary: 'logKey=k1',
        scope: { stepId: 's1', phase: 'run' },
      }),
      expect.objectContaining({
        kind: 'tool.error',
        toolName: 'tool',
        scope: { stepId: 's1', phase: 'run' },
      }),
      expect.objectContaining({
        kind: 'agent.output',
        output: '{"guess":2}',
        scope: { stepId: 's1', phase: 'run' },
      }),
      expect.objectContaining({
        kind: 'agent.text',
        text: 'Trailing text',
        scope: { stepId: 's1', phase: 'run' },
      }),
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

it('attaches matrixIndex, matrixTotal, phase, guardrailIndex, and attempt scopes to UI entries and callbacks', async () => {
  vi.useFakeTimers()
  const dir = setup()
  const streams = path.join(dir, 'streams')
  fs.mkdirSync(streams)
  const entries: RunUiEntry[] = []
  const startedGuardrails: unknown[] = []
  const gateChanges: Array<{ waiting: boolean, scope: unknown }> = []
  const unregister = registerRunUiHost({
    pushEntry: e => entries.push(e),
    setActivity: () => {},
    onGuardrailStarted: scope => startedGuardrails.push(scope),
    setGateWaiting: (waiting, scope) => gateChanges.push({ waiting, scope }),
  })

  try {
    fs.writeFileSync(path.join(dir, 'ledger.jsonl'), [
      JSON.stringify({
        eventType: 'guardrail.started',
        stepId: 'impl',
        matrixIndex: 1,
        payload: {
          phase: 'beforeStep',
          guardrailIndex: 0,
          guardrailName: 'diff',
          attempt: 1,
          matrixTotal: 3,
        },
      }),
      JSON.stringify({
        eventType: 'agent.stream.linked',
        stepId: 'impl',
        matrixIndex: 1,
        payload: { sessionId: 'sess-m1', attempt: 2, matrixTotal: 3 },
      }),
      JSON.stringify({
        eventType: 'gate.waiting',
        stepId: 'impl',
        matrixIndex: 1,
        payload: { phase: 'afterStep', guardrailIndex: 0 },
      }),
      JSON.stringify({
        eventType: 'gate.resolved',
        stepId: 'impl',
        matrixIndex: 1,
        payload: { phase: 'afterStep', guardrailIndex: 0 },
      }),
      JSON.stringify({
        eventType: 'gate.waiting',
        stepId: 'impl',
        payload: { phase: 'interactive', guardrailIndex: 0 },
      }),
      JSON.stringify({
        eventType: 'guardrail.started',
        payload: { matrixIndex: 0 },
      }),
      JSON.stringify({
        eventType: 'guardrail.started',
      }),
      JSON.stringify({
        eventType: 'agent.stream.linked',
        payload: { sessionId: 'sess-unscoped' },
      }),
      '',
    ].join('\n'))

    fs.writeFileSync(path.join(streams, 'sess-unscoped.jsonl'), [
      JSON.stringify({ eventType: 'turn.started', payload: {} }),
      JSON.stringify({
        eventType: 'message_chunk',
        payload: { text: 'unscoped' },
      }),
      JSON.stringify({
        eventType: 'turn.completed',
        payload: { output: 'done' },
      }),
      '',
    ].join('\n'))

    fs.writeFileSync(path.join(streams, 'sess-m1.jsonl'), [
      JSON.stringify({
        eventType: 'turn.started',
        stepId: 'impl',
        payload: { attempt: 2 },
      }),
      JSON.stringify({
        eventType: 'message_chunk',
        stepId: 'impl',
        payload: { text: 'Working on slice 2' },
      }),
      '',
    ].join('\n'))

    const tailer = new LiveRunTailer(dir, false)
    tailer.start()
    await vi.advanceTimersByTimeAsync(100)
    tailer.stop()

    expect(startedGuardrails).toEqual([
      {
        stepId: 'impl',
        matrixIndex: 1,
        matrixTotal: 3,
        phase: 'beforeStep',
        guardrailIndex: 0,
        guardrailName: 'diff',
        attempt: 1,
      },
      {
        matrixIndex: 0,
      },
      {
        stepId: 'step',
      },
    ])
    expect(gateChanges).toEqual([
      {
        waiting: true,
        scope: {
          stepId: 'impl',
          matrixIndex: 1,
          phase: 'afterStep',
          guardrailIndex: 0,
        },
      },
      {
        waiting: false,
        scope: {
          stepId: 'impl',
          matrixIndex: 1,
          phase: 'afterStep',
          guardrailIndex: 0,
        },
      },
      {
        waiting: true,
        scope: {
          stepId: 'impl',
          phase: 'interactive',
          guardrailIndex: 0,
        },
      },
    ])
    expect(entries).toContainEqual({
      kind: 'agent.text',
      text: 'Working on slice 2',
      scope: {
        stepId: 'impl',
        matrixIndex: 1,
        matrixTotal: 3,
        phase: 'run',
        attempt: 2,
      },
    })
  }
  finally {
    unregister()
  }
})
