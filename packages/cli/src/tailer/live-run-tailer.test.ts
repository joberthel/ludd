import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
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
