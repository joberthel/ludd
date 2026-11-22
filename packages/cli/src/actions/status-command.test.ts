import type { RunStateSnapshot } from '@ludd/core'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { getControlSocketPath, startControlServer } from '@ludd/core'
import { afterEach, expect, it, vi } from 'vitest'
import { statusCommand } from './status-command.js'

const dirs: string[] = []
function setup() {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'ludd-status-'))
  dirs.push(workspace)
  const runDir = path.join(workspace, '.harness', 'runs', 'test-run')
  fs.mkdirSync(runDir, { recursive: true })
  fs.writeFileSync(path.join(runDir, 'state.json'), JSON.stringify({
    schemaVersion: 1,
    runId: 'test-run',
    harnessName: 'workflow',
    workflowName: 'workflow',
    configPath: 'harness.ts',
    status: 'waiting_for_gate',
    activeStepId: 'review',
    activeGate: {
      stepId: 'review',
      phase: 'afterStep',
      guardrailIndex: 0,
      gateType: 'human_review',
      prompt: 'Approve it?',
      createdAt: new Date().toISOString(),
    },
    steps: {
      done: { status: 'passed' },
    },
    updatedAt: new Date().toISOString(),
  }))
  fs.writeFileSync(path.join(runDir, 'runner.pid'), `${process.pid}\n`)
  return workspace
}
afterEach(() => {
  vi.restoreAllMocks()
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

it('prints run overview as machine-readable JSON', async () => {
  const workspace = setup()
  const log = vi.spyOn(console, 'log').mockImplementation(() => {})
  try {
    await expect(statusCommand({ workspace, json: true })).resolves.toBe(0)
    const rows = JSON.parse(log.mock.calls[0][0] as string)
    expect(rows[0]).toMatchObject({
      runId: 'test-run',
      workflow: 'workflow',
      status: 'waiting_for_gate',
      process: `alive (${process.pid})`,
      gate: 'human_review',
    })
  }
  finally { log.mockRestore() }
})

it('includes gate prompt and step progress in detailed JSON', async () => {
  const workspace = setup()
  const log = vi.spyOn(console, 'log').mockImplementation(() => {})
  try {
    await statusCommand({ workspace, runId: 'test-run', json: true })
    expect(JSON.parse(log.mock.calls[0][0] as string)).toMatchObject({
      activeGate: { prompt: 'Approve it?' },
      steps: {
        done: { status: 'passed' },
      },
    })
  }
  finally { log.mockRestore() }
})

it('prints table output for an empty run list when the runs directory is absent', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'ludd-status-empty-'))
  dirs.push(workspace)
  const log = vi.spyOn(console, 'log').mockImplementation(() => {})
  await expect(statusCommand({ workspace })).resolves.toBe(0)
  expect(log.mock.calls[0][0]).toContain('RUN ID')
})

it('prints table rows for runs with missing PID files and legacy config data', async () => {
  const workspace = setup()
  const runDir = path.join(workspace, '.harness', 'runs', 'test-run')
  fs.unlinkSync(path.join(runDir, 'runner.pid'))
  const statePath = path.join(runDir, 'state.json')
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'))
  delete state.configPath
  fs.writeFileSync(statePath, JSON.stringify(state))
  const log = vi.spyOn(console, 'log').mockImplementation(() => {})
  await expect(statusCommand({ workspace })).resolves.toBe(0)
  expect(log.mock.calls.map(call => call[0]).join('\n')).toContain('test-run')
  expect(log.mock.calls.map(call => call[0]).join('\n')).toContain('stopped')
})

it('marks stale runner PIDs as stopped', async () => {
  const workspace = setup()
  const runDir = path.join(workspace, '.harness', 'runs', 'test-run')
  fs.writeFileSync(path.join(runDir, 'runner.pid'), '999999\n')
  const log = vi.spyOn(console, 'log').mockImplementation(() => {})
  await expect(statusCommand({ workspace, json: true })).resolves.toBe(0)
  expect(JSON.parse(log.mock.calls[0][0] as string)[0].process).toBe('stopped')
})

it('skips non-directories, missing states, and invalid run state files', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'ludd-status-invalid-'))
  dirs.push(workspace)
  const runs = path.join(workspace, '.harness', 'runs')
  fs.mkdirSync(path.join(runs, 'missing-state'), { recursive: true })
  fs.writeFileSync(path.join(runs, 'not-a-directory'), 'ignored')
  fs.mkdirSync(path.join(runs, 'invalid-state'))
  fs.writeFileSync(path.join(runs, 'invalid-state', 'state.json'), '{ invalid')
  const log = vi.spyOn(console, 'log').mockImplementation(() => {})
  await expect(statusCommand({ workspace, json: true })).resolves.toBe(0)
  expect(JSON.parse(log.mock.calls[0][0] as string)).toEqual([])
})

it('throws when a requested run has no state file', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'ludd-status-missing-'))
  dirs.push(workspace)
  await expect(statusCommand({ workspace, runId: 'missing' })).rejects.toThrow('Run "missing" was not found.')
})

it('prints detailed text including matrices, environments, and gates', async () => {
  const workspace = setup()
  const statePath = path.join(workspace, '.harness', 'runs', 'test-run', 'state.json')
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'))
  state.activeMatrixIndex = 0
  state.environments = {
    host: { id: 'host', type: 'host', workingDir: '/tmp' },
  }
  fs.writeFileSync(statePath, JSON.stringify(state))
  const log = vi.spyOn(console, 'log').mockImplementation(() => {})
  await expect(statusCommand({ workspace, runId: 'test-run' })).resolves.toBe(0)
  expect(log.mock.calls.map(call => call[0]).join('\n')).toContain('Matrix cursor: 1')
  expect(log.mock.calls.map(call => call[0]).join('\n')).toContain('Gate (human_review):')
  expect(log.mock.calls.map(call => call[0]).join('\n')).toContain('host: host (/tmp)')
})

it('prints legacy details with no optional state properties or workspace option', async () => {
  const workspace = setup()
  const runDir = path.join(workspace, '.harness', 'runs', 'test-run')
  fs.unlinkSync(path.join(runDir, 'runner.pid'))
  const statePath = path.join(runDir, 'state.json')
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'))
  delete state.configPath
  state.activeStepId = null
  state.activeGate = null
  fs.writeFileSync(statePath, JSON.stringify(state))
  const cwd = vi.spyOn(process, 'cwd').mockReturnValue(workspace)
  const log = vi.spyOn(console, 'log').mockImplementation(() => {})
  try {
    await expect(statusCommand({ runId: 'test-run' })).resolves.toBe(0)
    const output = log.mock.calls.map(call => call[0]).join('\n')
    expect(output).toContain('Config: -')
    expect(output).toContain('Active step: -')
    expect(output).toContain('Environments:')
    expect(output).not.toContain('Matrix cursor:')
    expect(output).not.toContain('Gate (')
  }
  finally { cwd.mockRestore() }
})

it('refreshes detailed state through a live control socket', async () => {
  const workspace = setup()
  const runDir = path.join(workspace, '.harness', 'runs', 'test-run')
  const snapshot = JSON.parse(fs.readFileSync(path.join(runDir, 'state.json'), 'utf8')) as RunStateSnapshot
  const server = await startControlServer(runDir, {
    getStatus: () => snapshot,
  })
  const log = vi.spyOn(console, 'log').mockImplementation(() => {})
  try {
    await expect(statusCommand({ workspace, runId: 'test-run', json: true })).resolves.toBe(0)
    expect(JSON.parse(log.mock.calls[0][0] as string).activeGate.prompt).toBe('Approve it?')
  }
  finally { await server.close() }
})

it('falls back to persisted state when the control socket is unavailable', async () => {
  const workspace = setup()
  const runDir = path.join(workspace, '.harness', 'runs', 'test-run')
  const socketPath = getControlSocketPath(runDir)
  fs.writeFileSync(socketPath, 'not a socket')
  const log = vi.spyOn(console, 'log').mockImplementation(() => {})
  try {
    await expect(statusCommand({ workspace, runId: 'test-run', json: true })).resolves.toBe(0)
    expect(JSON.parse(log.mock.calls[0][0] as string).activeGate.prompt).toBe('Approve it?')
  }
  finally { fs.rmSync(socketPath, { force: true }) }
})
