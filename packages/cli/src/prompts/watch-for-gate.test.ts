import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { watchForGate } from './watch-for-gate.js'

const { createControlClient, readRunState, promptForGate } = vi.hoisted(() => ({
  createControlClient: vi.fn(),
  readRunState: vi.fn(),
  promptForGate: vi.fn(),
}))

vi.mock('@ludd/core', () => ({
  createControlClient,
  readRunState,
}))

vi.mock('./inline-gate-prompter.js', () => ({
  promptForGate,
}))

const tempDirs: string[] = []

afterEach(() => {
  vi.clearAllMocks()
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

it('returns immediately in worker mode or when signal is already aborted', async () => {
  const controller = new AbortController()
  controller.abort()
  await watchForGate('/tmp/nonexistent', () => false, true)
  await watchForGate('/tmp/nonexistent', () => false, false, controller.signal)
  expect(createControlClient).not.toHaveBeenCalled()
})

it('passes signal to promptForGate and exits cleanly when aborted while waiting', async () => {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ludd-watch-gate-'))
  tempDirs.push(runDir)
  fs.writeFileSync(path.join(runDir, 'state.json'), '{}')

  const close = vi.fn(async () => {})
  createControlClient.mockResolvedValue({ close })
  readRunState.mockReturnValue({
    status: 'waiting_for_gate',
    activeGate: {
      stepId: 'step-a',
      guardrailIndex: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  })

  const controller = new AbortController()
  let completed = false
  promptForGate.mockImplementation(async (_state: unknown, _client: unknown, signal?: AbortSignal) => {
    await new Promise<void>((resolve) => {
      signal?.addEventListener('abort', () => resolve(), { once: true })
    })
  })

  const watcher = watchForGate(runDir, () => completed, false, controller.signal)
  await vi.waitFor(() => expect(promptForGate).toHaveBeenCalledOnce())
  expect(promptForGate.mock.calls[0]?.[2]).toBe(controller.signal)

  completed = true
  controller.abort()
  await expect(watcher).resolves.toBeUndefined()
  expect(close).toHaveBeenCalledOnce()
})
