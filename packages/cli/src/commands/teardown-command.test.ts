import type { ControlClient } from '@ludd/core'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createControlClient, isProcessAlive, resolveRunDir, RUNNER_PID_FILE, teardownRun } from '@ludd/core'
import { afterEach, expect, it, vi } from 'vitest'
import { teardownCommand } from './teardown-command.js'

const directories: string[] = []
const client = {
  teardown: vi.fn(async () => ({ ok: true })),
  close: vi.fn(async () => {}),
} as unknown as ControlClient

vi.mock('@ludd/core', async importOriginal => ({
  ...await importOriginal<typeof import('@ludd/core')>(),
  createControlClient: vi.fn(async () => client),
  isProcessAlive: vi.fn(() => false),
  teardownRun: vi.fn(async () => {}),
}))

function workspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ludd-teardown-'))
  directories.push(dir)
  return dir
}

afterEach(() => {
  vi.clearAllMocks()
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
  vi.mocked(isProcessAlive).mockReturnValue(true)
  await teardownCommand({ runId: 'run-a', workspace: dir, force: true })
  expect(client.teardown).toHaveBeenCalledWith({ force: true })
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
