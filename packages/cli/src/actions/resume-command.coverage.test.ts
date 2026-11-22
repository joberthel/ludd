import type { RunStateSnapshot } from '@ludd/core'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resumeCommand } from './resume-command.js'

const mocks = vi.hoisted(() => ({
  loadHarnessConfig: vi.fn(async () => ({ name: 'workflow', steps: [] })),
  readRunState: vi.fn<(...args: string[]) => RunStateSnapshot>(),
  runHarness: vi.fn(),
  createControlClient: vi.fn(),
  promptForGate: vi.fn(async () => {}),
  tailerStart: vi.fn(),
  tailerStop: vi.fn(),
  clientClose: vi.fn(async () => {}),
}))

vi.mock('@ludd/core', async importOriginal => ({
  ...await importOriginal<typeof import('@ludd/core')>(),
  createControlClient: mocks.createControlClient,
  loadHarnessConfig: mocks.loadHarnessConfig,
  readRunState: mocks.readRunState,
  runHarness: mocks.runHarness,
}))
vi.mock('../prompts/inline-gate-prompter.js', () => ({ promptForGate: mocks.promptForGate }))
vi.mock('../tailer/live-run-tailer.js', () => ({
  LiveRunTailer: class {
    start() { mocks.tailerStart() }
    stop() { mocks.tailerStop() }
  },
}))
mocks.createControlClient.mockResolvedValue({ close: mocks.clientClose })

const directories: string[] = []
function state(status: RunStateSnapshot['status']): RunStateSnapshot {
  return {
    schemaVersion: 1,
    runId: 'run-a',
    harnessName: 'workflow',
    workflowName: 'workflow',
    configPath: 'harness.config.ts',
    status,
    activeStepId: status === 'waiting_for_gate'
      ? 'step-a'
      : null,
    activeGate: status === 'waiting_for_gate'
      ? {
          stepId: 'step-a',
          phase: 'beforeStep',
          guardrailIndex: 0,
          gateType: 'human_review',
          prompt: 'Continue?',
          createdAt: 'fixed-time',
        }
      : null,
    steps: {},
    updatedAt: 'fixed-time',
  }
}

function workspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ludd-resume-watch-'))
  directories.push(dir)
  const runDir = path.join(dir, '.harness', 'runs', 'run-a')
  fs.mkdirSync(runDir, { recursive: true })
  fs.writeFileSync(path.join(runDir, 'state.json'), '{}')
  fs.writeFileSync(path.join(dir, 'harness.config.ts'), 'export default {}')
  return dir
}

afterEach(() => {
  vi.clearAllMocks()
  mocks.runHarness.mockReset()
  mocks.readRunState.mockReset()
  mocks.createControlClient.mockResolvedValue({ close: mocks.clientClose })
  for (const dir of directories.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('resumeCommand gate watcher', () => {
  it('retries when state disappears, clears stale gates, and avoids prompting the same gate twice', async () => {
    const dir = workspace()
    const statePath = path.join(dir, '.harness', 'runs', 'run-a', 'state.json')
    mocks.readRunState
      .mockReturnValueOnce(state('failed'))
      .mockReturnValueOnce(state('running'))
      .mockReturnValueOnce(state('waiting_for_gate'))
      .mockReturnValue(state('waiting_for_gate'))
    mocks.runHarness.mockImplementation(async () => {
      fs.rmSync(statePath)
      setTimeout(() => fs.writeFileSync(statePath, '{}'), 120)
      return new Promise(resolve => setTimeout(resolve, 470, { status: 'passed' }))
    })
    await expect(resumeCommand({ runId: 'run-a', workspace: dir })).resolves.toBe(0)
    expect(mocks.readRunState.mock.calls.length).toBeGreaterThanOrEqual(4)
    expect(mocks.promptForGate).toHaveBeenCalledOnce()
    expect(mocks.clientClose).toHaveBeenCalledOnce()
  })

  it('skips gate watching in worker mode without connecting a control client', async () => {
    const dir = workspace()
    mocks.readRunState
      .mockReturnValueOnce(state('failed'))
      .mockReturnValue(state('waiting_for_gate'))
    mocks.runHarness.mockImplementation(async () => new Promise(resolve => setTimeout(resolve, 150, { status: 'passed' })))
    await expect(resumeCommand({ runId: 'run-a', workspace: dir, worker: true })).resolves.toBe(0)
    expect(mocks.createControlClient).not.toHaveBeenCalled()
    expect(mocks.promptForGate).not.toHaveBeenCalled()
    expect(mocks.clientClose).not.toHaveBeenCalled()
  })
})
