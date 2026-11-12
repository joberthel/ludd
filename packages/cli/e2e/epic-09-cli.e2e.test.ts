import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { afterAll, expect, it } from 'vitest'
import { cli, launch, launchWithHumanReview, readPid, runJson, until, waitForProcessExit } from './cli-test-helpers.js'

const workspaces: string[] = []
const daemons = new Set<number>()

function workspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ludd-cli-e2e-'))
  workspaces.push(dir)
  const config = `import { defineHarness } from '@ludd/core'\nconst review = { __kind: 'guardrail', type: 'human_review', prompt: 'Approve e2e?', execute: async () => ({ status: 'pass', body: 'Approved' }) }\nexport default defineHarness({ name: 'e2e-custom', steps: [{ id: 'step', run: async () => ({ ok: true }), beforeStep: [review], afterStep: [review] }] })\n`
  fs.writeFileSync(path.join(dir, 'custom.config.ts'), config)
  return dir
}

afterAll(async () => {
  for (const pid of daemons) {
    try {
      process.kill(pid, 'SIGTERM')
    }
    catch {
      // Already exited.
    }
  }
  await delay(100)
  for (const dir of workspaces) fs.rmSync(dir, { recursive: true, force: true })
})

it('runs foreground interactive gates, persists custom config, and rejects duplicate run IDs', async () => {
  const dir = workspace()
  const child = spawn(process.execPath, [
    cli,
    'run',
    'custom.config.ts',
    '--run-id',
    'foreground',
    '--workspace',
    dir,
  ], {
    cwd: dir,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.setEncoding('utf8').on('data', data => output += data)
  child.stderr.setEncoding('utf8').on('data', data => output += data)
  await until(() => output.includes('Action [p]ass') || child.exitCode !== null, 10_000, output)
  expect(output).toContain('Action [p]ass')
  child.stdin.write('p\n')
  await until(() => output.includes('Feedback (required on fail):') || child.exitCode !== null, 10_000, output)
  child.stdin.write('Approved\n')
  await until(() => output.split('Action [p]ass').length > 2 || child.exitCode !== null, 10_000, output)
  child.stdin.write('p\n')
  await until(() => output.split('Feedback (required on fail):').length > 2 || child.exitCode !== null, 10_000, output)
  child.stdin.end('Approved\n')
  const code = await new Promise<number | null>(resolve => child.once('close', resolve))
  expect(code).toBe(0)
  const statePath = path.join(dir, '.harness/runs/foreground/state.json')
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'))
  expect(state.status).toBe('passed')
  expect(state.configPath).toBe('custom.config.ts')
  const duplicate = await launch([
    'run',
    'custom.config.ts',
    '--run-id',
    'foreground',
    '--workspace',
    dir,
  ], dir)
  expect(duplicate.code).toBe(1)
  expect(duplicate.stderr).toContain('already exists')
}, 20_000)

async function startDetachedRun(dir: string, runId: string): Promise<number> {
  const started = await launch([
    'run',
    'custom.config.ts',
    '--run-id',
    runId,
    '--workspace',
    dir,
    '--detach',
  ], dir)
  expect(started.code, started.stderr).toBe(0)
  return readPid(dir, runId)
}

async function terminateAndResume(dir: string, pid: number): Promise<number> {
  daemons.add(pid)
  process.kill(pid, 'SIGTERM')
  await waitForProcessExit(pid)
  daemons.delete(pid)
  const persistedState = JSON.parse(fs.readFileSync(path.join(dir, '.harness/runs/detached/state.json'), 'utf8'))
  expect(persistedState.configPath).toBe('custom.config.ts')

  const resumed = await launch([
    'resume',
    'detached',
    '--workspace',
    dir,
    '--detach',
  ], dir)
  expect(resumed.code, resumed.stderr).toBe(0)
  const resumedPid = readPid(dir, 'detached')
  daemons.add(resumedPid)
  expect(resumedPid).not.toBe(pid)
  return resumedPid
}

async function passDetachedGates(dir: string): Promise<void> {
  const gate = await launch([
    'gate',
    'detached',
    '--workspace',
    dir,
    '--action',
    'pass',
  ], dir)
  expect(gate.code, gate.stderr).toBe(0)
  await until(() => {
    const state = JSON.parse(fs.readFileSync(path.join(dir, '.harness/runs/detached/state.json'), 'utf8'))
    return state.status === 'waiting_for_gate' && state.activeGate?.phase === 'afterStep'
  })
  const finalGate = await launch([
    'gate',
    'detached',
    '--workspace',
    dir,
    '--action',
    'pass',
  ], dir)
  expect(finalGate.code, finalGate.stderr).toBe(0)
  await until(() => JSON.parse(fs.readFileSync(path.join(dir, '.harness/runs/detached/state.json'), 'utf8')).status === 'passed', 10_000, fs.readFileSync(path.join(dir, '.harness/runs/detached/state.json'), 'utf8'))
}

async function verifyTargetedGc(dir: string, resumedPid: number): Promise<void> {
  const other = await launchWithHumanReview([
    'run',
    'custom.config.ts',
    '--run-id',
    'keep',
    '--workspace',
    dir,
  ], dir)
  expect(other.code).toBe(0)
  const gc = await launch([
    'gc',
    '--workspace',
    dir,
    '--run-id',
    'detached',
  ], dir)
  expect(gc.code, gc.stderr).toBe(0)
  expect(fs.existsSync(path.join(dir, '.harness/runs/detached'))).toBe(false)
  expect(fs.existsSync(path.join(dir, '.harness/runs/keep/state.json'))).toBe(true)
  daemons.delete(resumedPid)
}

async function verifyAbortWithTeardown(dir: string): Promise<void> {
  const abortPid = await startDetachedRun(dir, 'abort')
  daemons.add(abortPid)
  const aborted = await launch([
    'abort',
    'abort',
    '--workspace',
    dir,
    '--reason',
    'Stop e2e run',
    '--teardown',
  ], dir)
  expect(aborted.code, aborted.stderr).toBe(0)
  await until(() => JSON.parse(fs.readFileSync(path.join(dir, '.harness/runs/abort/state.json'), 'utf8')).status === 'failed')
  await waitForProcessExit(abortPid)
  daemons.delete(abortPid)
}

it('controls detached runs over the socket, resumes them, and garbage-collects only targeted runs', async () => {
  const dir = workspace()
  const pid = await startDetachedRun(dir, 'detached')
  const status = await runJson([
    'status',
    'detached',
    '--workspace',
    dir,
    '--json',
  ], dir)
  expect(status.status).toBe('waiting_for_gate')
  expect(status.process).toMatch(/^alive/)
  const resumedPid = await terminateAndResume(dir, pid)
  await passDetachedGates(dir)
  await verifyTargetedGc(dir, resumedPid)
  await verifyAbortWithTeardown(dir)
}, 30_000)
