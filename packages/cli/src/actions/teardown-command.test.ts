import type { ControlClient } from '@luddjs/core'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  createControlClient,
  getControlSocketPath,
  isProcessAlive,
  resolveRunDir,
  RUNNER_PID_FILE,
  teardownRun,
} from '@luddjs/core'
import { afterEach, expect, it, vi } from 'vitest'
import { teardownCommand } from './teardown-command.js'

const directories: string[] = []
const socketFiles: string[] = []
const client = {
  teardown: vi.fn(async () => ({ ok: true })),
  close: vi.fn(async () => {}),
} as unknown as ControlClient

vi.mock('@luddjs/core', async importOriginal => ({
  ...await importOriginal<typeof import('@luddjs/core')>(),
  createControlClient: vi.fn(async () => client),
  isProcessAlive: vi.fn(() => false),
  teardownRun: vi.fn(async () => ({ ok: true })),
}))

function workspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ludd-teardown-'))
  directories.push(dir)
  return dir
}

function createControlSocketStub(runDir: string): string {
  const socketPath = getControlSocketPath(runDir)
  fs.mkdirSync(path.dirname(socketPath), { recursive: true })
  fs.writeFileSync(socketPath, '')
  socketFiles.push(socketPath)
  return socketPath
}

afterEach(() => {
  vi.clearAllMocks()
  for (const file of socketFiles.splice(0)) fs.rmSync(file, { force: true })
  for (const dir of directories.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

it('tears down an inactive run programmatically and defaults force to false', async () => {
  const dir = workspace()
  const log = vi.spyOn(console, 'log').mockImplementation(() => {})
  await expect(teardownCommand({ runId: 'run-a', workspace: dir })).resolves.toBe(0)
  expect(teardownRun).toHaveBeenCalledWith('run-a', { workspaceDir: dir })
  expect(createControlClient).not.toHaveBeenCalled()
  expect(log).toHaveBeenCalledWith('Tore down run run-a')
  log.mockRestore()
})

it('forwards force to programmatic teardown when the PID file is missing', async () => {
  const dir = workspace()
  await teardownCommand({ runId: 'run-a', workspace: dir, force: true })
  expect(teardownRun).toHaveBeenCalledWith('run-a', { workspaceDir: dir, force: true })
})

it('forwards configPath to programmatic teardown when provided', async () => {
  const dir = workspace()
  await teardownCommand({ runId: 'run-a', workspace: dir, configPath: 'custom.config.ts' })
  expect(teardownRun).toHaveBeenCalledWith('run-a', { workspaceDir: dir, configPath: 'custom.config.ts' })
})

it('defaults the workspace to the current directory', async () => {
  const cwd = vi.spyOn(process, 'cwd').mockReturnValue('/tmp/ludd-default-workspace')
  await teardownCommand({ runId: 'run-a' })
  expect(teardownRun).toHaveBeenCalledWith('run-a', { workspaceDir: '/tmp/ludd-default-workspace' })
  cwd.mockRestore()
})

it('uses the active control client and omits force by default', async () => {
  const dir = workspace()
  const runDir = resolveRunDir(dir, 'run-a')
  fs.mkdirSync(runDir, { recursive: true })
  fs.writeFileSync(path.join(runDir, RUNNER_PID_FILE), `${process.pid}\n`)
  createControlSocketStub(runDir)
  vi.mocked(isProcessAlive).mockReturnValue(true)
  await teardownCommand({ runId: 'run-a', workspace: dir })
  expect(createControlClient).toHaveBeenCalledWith(runDir)
  expect(client.teardown).toHaveBeenCalledWith({})
  expect(client.close).toHaveBeenCalledOnce()
  expect(teardownRun).not.toHaveBeenCalled()
})

it('forwards force to a live control client', async () => {
  const dir = workspace()
  const runDir = resolveRunDir(dir, 'run-a')
  fs.mkdirSync(runDir, { recursive: true })
  fs.writeFileSync(path.join(runDir, RUNNER_PID_FILE), `${process.pid}\n`)
  createControlSocketStub(runDir)
  vi.mocked(isProcessAlive).mockReturnValue(true)
  await teardownCommand({ runId: 'run-a', workspace: dir, force: true })
  expect(client.teardown).toHaveBeenCalledWith({ force: true })
})

it('falls back to teardownRun when runner.pid is alive without a control socket or with unreachable socket under force', async () => {
  const dir = workspace()
  const runDir = resolveRunDir(dir, 'run-a')
  fs.mkdirSync(runDir, { recursive: true })
  fs.writeFileSync(path.join(runDir, RUNNER_PID_FILE), `${process.pid}\n`)
  vi.mocked(isProcessAlive).mockReturnValue(true)

  // Missing socket falls back to teardownRun (with configPath and force forwarded).
  await teardownCommand({
    runId: 'run-a',
    workspace: dir,
    configPath: 'fallback.config.ts',
    force: true,
  })
  expect(createControlClient).not.toHaveBeenCalled()
  expect(teardownRun).toHaveBeenCalledWith('run-a', {
    workspaceDir: dir,
    configPath: 'fallback.config.ts',
    force: true,
  })

  // Stale socket failing with ECONNREFUSED or ENOENT under force also falls back to teardownRun.
  vi.mocked(teardownRun).mockClear()
  createControlSocketStub(runDir)
  vi.mocked(createControlClient)
    .mockRejectedValueOnce(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }))
    .mockRejectedValueOnce(Object.assign(new Error('connect ENOENT'), { code: 'ENOENT' }))

  await teardownCommand({
    runId: 'run-a',
    workspace: dir,
    configPath: 'fallback.config.ts',
    force: true,
  })
  await teardownCommand({ runId: 'run-a', workspace: dir, force: true })
  expect(teardownRun).toHaveBeenCalledTimes(2)
})

it('rethrows socket errors when force is false or error is non-recoverable', async () => {
  const dir = workspace()
  const runDir = resolveRunDir(dir, 'run-a')
  fs.mkdirSync(runDir, { recursive: true })
  fs.writeFileSync(path.join(runDir, RUNNER_PID_FILE), `${process.pid}\n`)
  createControlSocketStub(runDir)
  vi.mocked(isProcessAlive).mockReturnValue(true)

  vi.mocked(createControlClient).mockRejectedValueOnce(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }))
  await expect(teardownCommand({ runId: 'run-a', workspace: dir })).rejects.toThrow('connect ECONNREFUSED')

  vi.mocked(createControlClient).mockRejectedValueOnce(Object.assign(new Error('permission denied'), { code: 'EACCES' }))
  await expect(teardownCommand({ runId: 'run-a', workspace: dir, force: true })).rejects.toThrow('permission denied')
})

it('falls back to programmatic teardown for a stale PID', async () => {
  const dir = workspace()
  const runDir = resolveRunDir(dir, 'run-a')
  fs.mkdirSync(runDir, { recursive: true })
  fs.writeFileSync(path.join(runDir, RUNNER_PID_FILE), '999999\n')
  vi.mocked(isProcessAlive).mockReturnValue(false)
  await teardownCommand({ runId: 'run-a', workspace: dir })
  expect(teardownRun).toHaveBeenCalledWith('run-a', { workspaceDir: dir })
})
