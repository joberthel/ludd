import type { RunStateSnapshot } from '@ludd/core'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createControlClient, loadHarnessConfig, readRunState, runHarness } from '@ludd/core'
import { afterEach, expect, it, vi } from 'vitest'
import { runCommand } from './run-command.js'

const mocks = vi.hoisted(() => ({
  loadHarnessConfig: vi.fn(async () => ({ name: 'workflow', steps: [] })),
  readRunState: vi.fn<(...args: string[]) => RunStateSnapshot>(),
  runHarness: vi.fn<() => Promise<{ status: 'passed' | 'failed' }>>(async () => ({ status: 'passed' })),
  createControlClient: vi.fn(),
  promptForGate: vi.fn(async () => {}),
  spawnDetachedRunner: vi.fn(async () => 0),
  tailerStart: vi.fn(),
  tailerStop: vi.fn(),
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
vi.mock('../daemon/spawn-detached-runner.js', () => ({ spawnDetachedRunner: mocks.spawnDetachedRunner }))

const directories: string[] = []
function workspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ludd-run-command-'))
  directories.push(dir)
  return dir
}

function waitingState(): RunStateSnapshot {
  return {
    schemaVersion: 1,
    runId: 'run-a',
    harnessName: 'workflow',
    workflowName: 'workflow',
    status: 'waiting_for_gate',
    activeStepId: 'step-a',
    activeGate: {
      stepId: 'step-a',
      phase: 'beforeStep',
      guardrailIndex: 0,
      gateType: 'human_review',
      prompt: 'Continue?',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    steps: {},
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

afterEach(() => {
  vi.clearAllMocks()
  mocks.loadHarnessConfig.mockResolvedValue({ name: 'workflow', steps: [] })
  mocks.runHarness.mockResolvedValue({ status: 'passed' })
  mocks.createControlClient.mockResolvedValue({
    close: vi.fn(async () => {}),
    resolveGate: vi.fn(),
  })
  for (const dir of directories.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

it('loads defaults and completes a foreground run, stopping its tailer', async () => {
  const dir = workspace()
  await expect(runCommand({ workspace: dir, runId: 'run-a' })).resolves.toBe(0)
  expect(loadHarnessConfig).toHaveBeenCalledWith(path.join(dir, 'harness.config.ts'))
  expect(runHarness).toHaveBeenCalledWith({ name: 'workflow', steps: [] }, {
    runId: 'run-a',
    workspaceDir: dir,
    configPath: 'harness.config.ts',
  })
  expect(mocks.tailerStart).toHaveBeenCalledOnce()
  expect(mocks.tailerStop).toHaveBeenCalledOnce()
})

it('uses detached runner after loading the selected config', async () => {
  const dir = workspace()
  await expect(runCommand({
    workspace: dir,
    configPath: 'release.ts',
    runId: 'run-a',
    detach: true,
  })).resolves.toBe(0)
  expect(mocks.spawnDetachedRunner).toHaveBeenCalledWith({
    configPath: path.join(dir, 'release.ts'),
    runId: 'run-a',
    workspaceDir: dir,
  })
  expect(runHarness).not.toHaveBeenCalled()
})

it('generates a run ID and executes workers in process even if detach is set', async () => {
  await expect(runCommand({ detach: true, worker: true })).resolves.toBe(0)
  const options = vi.mocked(runHarness).mock.calls[0][1]!
  expect(options.runId).toMatch(/^[0-9a-f-]{36}$/)
  expect(options.workspaceDir).toBe(process.cwd())
  expect(mocks.spawnDetachedRunner).not.toHaveBeenCalled()
})

it('prompts once for a gate and closes its control client', async () => {
  const dir = workspace()
  mocks.readRunState.mockReturnValue(waitingState())
  const runDir = path.join(dir, '.harness', 'runs', 'run-a')
  let finishRun!: (result: { status: 'passed' }) => void
  mocks.runHarness.mockImplementation(async () => {
    fs.mkdirSync(runDir, { recursive: true })
    fs.writeFileSync(path.join(runDir, 'state.json'), '{}')
    return new Promise((resolve) => {
      finishRun = resolve
    })
  })
  const client = {
    close: vi.fn(async () => {}),
    resolveGate: vi.fn(),
  }
  mocks.createControlClient.mockResolvedValue(client)
  const running = runCommand({ workspace: dir, runId: 'run-a' })
  await vi.waitFor(() => expect(mocks.promptForGate).toHaveBeenCalledOnce(), { timeout: 2000 })
  await new Promise(resolve => setTimeout(resolve, 120))
  finishRun({ status: 'passed' })
  await expect(running).resolves.toBe(0)
  expect(mocks.promptForGate).toHaveBeenCalledWith(waitingState(), client)
  expect(client.close).toHaveBeenCalledOnce()
})

it('stops the gate watcher after the run completes while the client closes', async () => {
  const dir = workspace()
  mocks.readRunState.mockReturnValue(waitingState())
  const runDir = path.join(dir, '.harness', 'runs', 'run-a')
  let finishRun!: (result: { status: 'passed' }) => void
  mocks.runHarness.mockImplementation(async () => {
    fs.mkdirSync(runDir, { recursive: true })
    fs.writeFileSync(path.join(runDir, 'state.json'), '{}')
    return new Promise((resolve) => {
      finishRun = resolve
    })
  })
  let finishClose!: () => void
  const client = {
    close: vi.fn(async () => {
      await new Promise<void>((resolve) => {
        finishClose = resolve
      })
    }),
    resolveGate: vi.fn(),
  }
  mocks.createControlClient.mockResolvedValue(client)
  const running = runCommand({ workspace: dir, runId: 'run-a' })
  await vi.waitFor(() => expect(mocks.promptForGate).toHaveBeenCalledOnce(), { timeout: 2000 })
  finishRun({ status: 'passed' })
  await vi.waitFor(() => expect(mocks.tailerStop).toHaveBeenCalledOnce(), { timeout: 2000 })
  finishClose()
  await expect(running).resolves.toBe(0)
  expect(client.close).toHaveBeenCalledOnce()
})

it('skips gate watching in worker mode', async () => {
  const dir = workspace()
  mocks.readRunState.mockReturnValue(waitingState())
  const runDir = path.join(dir, '.harness', 'runs', 'run-a')
  let finishRun!: (result: { status: 'passed' | 'failed' }) => void
  mocks.runHarness.mockImplementation(async () => {
    fs.mkdirSync(runDir, { recursive: true })
    fs.writeFileSync(path.join(runDir, 'state.json'), '{}')
    return new Promise((resolve) => {
      finishRun = resolve
    })
  })
  const running = runCommand({ workspace: dir, runId: 'run-a', worker: true })
  await vi.waitFor(() => expect(mocks.runHarness).toHaveBeenCalledOnce(), { timeout: 2000 })
  await new Promise(resolve => setTimeout(resolve, 150))
  finishRun({ status: 'failed' })
  await expect(running).resolves.toBe(1)
  expect(createControlClient).not.toHaveBeenCalled()
  expect(mocks.promptForGate).not.toHaveBeenCalled()
})

it('waits for run initialization before reading state', async () => {
  const dir = workspace()
  let finishRun!: (result: { status: 'passed' }) => void
  mocks.runHarness.mockImplementation(async () => new Promise((resolve) => {
    finishRun = resolve
  }))
  const running = runCommand({ workspace: dir, runId: 'run-a' })
  await vi.waitFor(() => expect(mocks.tailerStart).toHaveBeenCalledOnce())
  await new Promise(resolve => setTimeout(resolve, 120))
  finishRun({ status: 'passed' })
  await expect(running).resolves.toBe(0)
  expect(readRunState).not.toHaveBeenCalled()
})

it('clears a remembered gate when state is no longer waiting', async () => {
  const dir = workspace()
  const runDir = path.join(dir, '.harness', 'runs', 'run-a')
  mocks.readRunState.mockReturnValue({
    ...waitingState(),
    status: 'running',
    activeGate: null,
  })
  let finishRun!: (result: { status: 'passed' }) => void
  mocks.runHarness.mockImplementation(async () => {
    fs.mkdirSync(runDir, { recursive: true })
    fs.writeFileSync(path.join(runDir, 'state.json'), '{}')
    return new Promise((resolve) => {
      finishRun = resolve
    })
  })
  const running = runCommand({ workspace: dir, runId: 'run-a' })
  await new Promise(resolve => setTimeout(resolve, 120))
  expect(readRunState).toHaveBeenCalled()
  expect(mocks.createControlClient).not.toHaveBeenCalled()
  finishRun({ status: 'passed' })
  await expect(running).resolves.toBe(0)
})
