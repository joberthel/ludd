import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { afterEach, expect, it, vi } from 'vitest'
import { LiveRunTailer } from './live-run-tailer.js'

const directories: string[] = []

function setup(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ludd-tailer-'))
  directories.push(dir)
  return dir
}

afterEach(() => {
  vi.useRealTimers()
  for (const dir of directories.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

it('stops safely before it has been started', () => {
  const tailer = new LiveRunTailer(setup(), false)
  expect(() => tailer.stop()).not.toThrow()
})

it('tails ledger events and linked stream files, skipping malformed records', async () => {
  vi.useFakeTimers()
  const dir = setup()
  const streams = path.join(dir, 'streams')
  fs.mkdirSync(streams)
  const log = vi.spyOn(console, 'log').mockImplementation(() => {})
  const tailer = new LiveRunTailer(dir, true)
  tailer.start()
  await vi.advanceTimersByTimeAsync(100)
  fs.writeFileSync(path.join(dir, 'ledger.jsonl'), [
    '{bad json',
    JSON.stringify({
      eventType: 'agent.stream.linked',
      stepId: 'agent',
      payload: { sessionId: 'session-a' },
    }),
    JSON.stringify({
      eventType: 'agent.stream.linked',
      payload: { sessionId: 42 },
    }),
    JSON.stringify({ eventType: 'run.started', stepId: null }),
    JSON.stringify({ stepId: 'step-empty' }),
    '',
  ].join('\n'))
  fs.writeFileSync(path.join(streams, 'session-a.jsonl'), '{"event":"token"}\n')
  await vi.advanceTimersByTimeAsync(100)
  await vi.advanceTimersByTimeAsync(100)
  tailer.stop()
  expect(log.mock.calls).toEqual([
    ['[agent.stream.linked] agent'],
    ['[agent.stream.linked]'],
    ['[run.started]'],
    ['[event] step-empty'],
    ['{"event":"token"}'],
  ])
  log.mockRestore()
})

it('detects truncation and does nothing after stop', async () => {
  vi.useFakeTimers()
  const dir = setup()
  const file = path.join(dir, 'ledger.jsonl')
  fs.writeFileSync(file, `${JSON.stringify({
    eventType: 'agent.stream.linked',
    payload: { sessionId: 'ignored-session' },
  })}\n`)
  const log = vi.spyOn(console, 'log').mockImplementation(() => {})
  const tailer = new LiveRunTailer(dir, false)
  tailer.start()
  await vi.advanceTimersByTimeAsync(100)
  fs.writeFileSync(file, `${JSON.stringify({ eventType: 'short' })}\n`)
  await vi.advanceTimersByTimeAsync(100)
  tailer.stop()
  await vi.advanceTimersByTimeAsync(200)
  expect(log.mock.calls).toEqual([
    ['[agent.stream.linked]'],
    ['[short]'],
  ])
  log.mockRestore()
})

it('preserves partial JSONL lines across polls without dropping events', async () => {
  vi.useFakeTimers()
  const dir = setup()
  const file = path.join(dir, 'ledger.jsonl')
  const log = vi.spyOn(console, 'log').mockImplementation(() => {})
  const tailer = new LiveRunTailer(dir, false)
  tailer.start()

  // First write: only a partial line with no newline
  fs.writeFileSync(file, '{"eventType":"run.')
  await vi.advanceTimersByTimeAsync(100)
  expect(log.mock.calls).toEqual([])

  // Second write: completes the first line and starts a second partial line
  fs.appendFileSync(file, 'started"}\n{"eventType":"step.')
  await vi.advanceTimersByTimeAsync(100)
  expect(log.mock.calls).toEqual([
    ['[run.started]'],
  ])

  // Third write: completes the second line
  fs.appendFileSync(file, 'completed","stepId":"s1"}\n')
  await vi.advanceTimersByTimeAsync(100)
  tailer.stop()

  expect(log.mock.calls).toEqual([
    ['[run.started]'],
    ['[step.completed] s1'],
  ])
  log.mockRestore()
})

it('does not split multi-byte UTF-8 characters across reads', async () => {
  vi.useFakeTimers()
  const dir = setup()
  const streams = path.join(dir, 'streams')
  fs.mkdirSync(streams)
  const ledger = path.join(dir, 'ledger.jsonl')
  const streamFile = path.join(streams, 's1.jsonl')
  const log = vi.spyOn(console, 'log').mockImplementation(() => {})

  fs.writeFileSync(ledger, `${JSON.stringify({
    eventType: 'agent.stream.linked',
    payload: { sessionId: 's1' },
  })}\n`)

  const tailer = new LiveRunTailer(dir, true)
  tailer.start()
  await vi.advanceTimersByTimeAsync(100)

  // Split a 4-byte UTF-8 emoji (🚀 = F0 9F 9A 80) across two writes
  const fullLine = Buffer.from('{"text":"🚀"}\n', 'utf8')
  const splitPoint = fullLine.indexOf(0xF0) + 2
  fs.writeFileSync(streamFile, fullLine.subarray(0, splitPoint))
  await vi.advanceTimersByTimeAsync(100)
  expect(log.mock.calls).toEqual([
    ['[agent.stream.linked]'],
  ])

  fs.appendFileSync(streamFile, fullLine.subarray(splitPoint))
  await vi.advanceTimersByTimeAsync(100)
  tailer.stop()

  expect(log.mock.calls).toEqual([
    ['[agent.stream.linked]'],
    ['{"text":"🚀"}'],
  ])
  log.mockRestore()
})

it('prints error details from ledger failure events', async () => {
  vi.useFakeTimers()
  const dir = setup()
  const ledger = path.join(dir, 'ledger.jsonl')
  const log = vi.spyOn(console, 'log').mockImplementation(() => {})

  fs.writeFileSync(ledger, [
    JSON.stringify({
      eventType: 'step.failed',
      stepId: 'step',
      payload: { error: 'Provider rejected model' },
    }),
    JSON.stringify({
      eventType: 'run.failed',
      stepId: null,
      payload: { error: 'Provider rejected model' },
    }),
    JSON.stringify({
      eventType: 'step.failed',
      stepId: 'blank',
      payload: { error: '   ' },
    }),
    '',
  ].join('\n'))

  const tailer = new LiveRunTailer(dir, false)
  tailer.start()
  await vi.advanceTimersByTimeAsync(100)
  tailer.stop()

  expect(log.mock.calls).toEqual([
    ['[step.failed] step: Provider rejected model'],
    ['[run.failed]: Provider rejected model'],
    ['[step.failed] blank'],
  ])
  log.mockRestore()
})

it('includes guardrailName in non-UI stdout fallback when present on guardrail events', async () => {
  vi.useFakeTimers()
  const dir = setup()
  const ledger = path.join(dir, 'ledger.jsonl')
  const log = vi.spyOn(console, 'log').mockImplementation(() => {})

  fs.writeFileSync(ledger, [
    JSON.stringify({
      eventType: 'guardrail.started',
      stepId: 's1',
      payload: { guardrailName: 'typecheck' },
    }),
    JSON.stringify({
      eventType: 'guardrail.passed',
      stepId: 's1',
      payload: { guardrailName: 'typecheck' },
    }),
    JSON.stringify({
      eventType: 'guardrail.skipped',
      stepId: 's1',
    }),
    '',
  ].join('\n'))

  const tailer = new LiveRunTailer(dir, false)
  tailer.start()
  await vi.advanceTimersByTimeAsync(100)
  tailer.stop()

  expect(log.mock.calls).toEqual([
    ['[guardrail.started] s1 (typecheck)'],
    ['[guardrail.passed] s1 (typecheck)'],
    ['[guardrail.skipped] s1'],
  ])
  log.mockRestore()
})

it('streams formatted agent text, tool calls, and structured output by default', async () => {
  vi.useFakeTimers()
  const dir = setup()
  const streams = path.join(dir, 'streams')
  fs.mkdirSync(streams)
  const log = vi.spyOn(console, 'log').mockImplementation(() => {})
  const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

  fs.writeFileSync(path.join(dir, 'ledger.jsonl'), `${JSON.stringify({
    eventType: 'agent.stream.linked',
    stepId: 'step',
    payload: { sessionId: 'sess-1' },
  })}\n`)
  fs.writeFileSync(path.join(streams, 'sess-1.jsonl'), [
    '{bad json',
    JSON.stringify({
      eventType: 'turn.started',
      stepId: 'step',
      payload: { prompt: 'hi' },
    }),
    JSON.stringify({ eventType: 'thought' }),
    JSON.stringify({
      eventType: 'thought',
      stepId: 'step',
      payload: { text: 'internal' },
    }),
    JSON.stringify({
      eventType: 'tool_call',
      stepId: 'step',
      payload: {
        phase: 'start',
        toolName: 'submit_step_output',
        args: { guess: 3 },
      },
    }),
    JSON.stringify({
      eventType: 'tool_call',
      stepId: 'step',
      payload: { phase: 'start' },
    }),
    JSON.stringify({
      eventType: 'tool_call',
      stepId: 'step',
      payload: { phase: 'end', toolName: 'submit_step_output', isError: false },
    }),
    JSON.stringify({
      eventType: 'tool_call',
      stepId: 'step',
      payload: { phase: 'end', toolName: 'read_log_page', isError: true },
    }),
    JSON.stringify({
      eventType: 'message_chunk',
      stepId: 'step',
      payload: { text: '' },
    }),
    JSON.stringify({
      eventType: 'message_chunk',
      stepId: 'step',
      payload: { text: 'Hello ' },
    }),
    JSON.stringify({
      eventType: 'message_chunk',
      stepId: 'step',
      payload: { text: 'world' },
    }),
    JSON.stringify({
      eventType: 'turn.completed',
      stepId: 'step',
      payload: {
        output: { guess: 3 },
      },
    }),
    JSON.stringify({
      eventType: 'turn.completed',
      stepId: 'step',
      payload: { output: 'Hello world' },
    }),
    JSON.stringify({
      eventType: 'turn.started',
      stepId: 'step',
      payload: { prompt: 'next' },
    }),
    JSON.stringify({
      eventType: 'turn.completed',
      payload: { output: 'plain output' },
    }),
    '',
  ].join('\n'))

  const tailer = new LiveRunTailer(dir, false)
  tailer.start()
  await vi.advanceTimersByTimeAsync(100)
  tailer.stop()

  expect(write.mock.calls).toEqual([
    ['Hello '],
    ['world'],
    ['\n'],
  ])
  expect(log.mock.calls).toEqual([
    ['[agent.stream.linked] step'],
    ['[tool] submit_step_output {"guess":3}'],
    ['[tool] tool'],
    ['[tool.error] read_log_page'],
    ['[agent.output] step: {"guess":3}'],
    ['[agent.output]: plain output'],
  ])
  write.mockRestore()
  log.mockRestore()
})
