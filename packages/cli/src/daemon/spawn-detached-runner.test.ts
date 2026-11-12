import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { afterEach, expect, it } from 'vitest'
import { spawnDetachedRunner } from './spawn-detached-runner.js'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

it('waits for the detached worker PID and state initialization', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'ludd-spawn-'))
  dirs.push(workspace)
  const entrypoint = path.join(workspace, 'fake-worker.js')
  fs.writeFileSync(entrypoint, `
      import fs from 'node:fs'; import path from 'node:path';
      const args = process.argv.slice(2); const get = key => args[args.indexOf(key) + 1];
      const dir = path.join(get('--workspace'), '.harness', 'runs', get('--run-id'));
      fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'runner.pid'), String(process.pid));
      fs.writeFileSync(path.join(dir, 'state.json'), '{}'); setInterval(() => {}, 1000);
    `)
  const priorEntrypoint = process.argv[1]
  process.argv[1] = entrypoint
  try {
    await expect(spawnDetachedRunner({
      configPath: path.join(workspace, 'harness.ts'),
      runId: 'background',
      workspaceDir: workspace,
    })).resolves.toBe(0)
    const pid = Number(fs.readFileSync(path.join(workspace, '.harness/runs/background/runner.pid'), 'utf8'))
    expect(pid).toBeGreaterThan(0)
    process.kill(pid, 'SIGTERM')
  }
  finally { process.argv[1] = priorEntrypoint }
})

it('requires the current CLI entrypoint', async () => {
  const priorEntrypoint = process.argv[1]
  process.argv[1] = ''
  try {
    await expect(spawnDetachedRunner({
      configPath: '/tmp/harness.ts',
      runId: 'missing-entrypoint',
      workspaceDir: os.tmpdir(),
    })).rejects.toThrow('Unable to locate the ludd CLI entrypoint')
  }
  finally { process.argv[1] = priorEntrypoint }
})

it('reports a detached process that exits before initialization', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'ludd-exit-before-init-'))
  dirs.push(workspace)
  const entrypoint = path.join(workspace, 'failing-worker.js')
  fs.writeFileSync(entrypoint, 'process.exitCode = 2\n')
  const priorEntrypoint = process.argv[1]
  process.argv[1] = entrypoint
  try {
    await expect(spawnDetachedRunner({
      configPath: path.join(workspace, 'harness.ts'),
      runId: 'failed-worker',
      workspaceDir: workspace,
      timeoutMs: 500,
    })).rejects.toThrow('failed to initialize')
  }
  finally { process.argv[1] = priorEntrypoint }
})

it('rejects a worker that writes initialization files but exits immediately', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'ludd-exit-after-init-'))
  dirs.push(workspace)
  const entrypoint = path.join(workspace, 'short-lived-worker.js')
  fs.writeFileSync(entrypoint, `import fs from 'node:fs'; import path from 'node:path'; const args = process.argv.slice(2); const get = key => args[args.indexOf(key) + 1]; const dir = path.join(get('--workspace'), '.harness', 'runs', get('--run-id')); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'runner.pid'), String(process.pid)); fs.writeFileSync(path.join(dir, 'state.json'), '{}');\n`)
  const priorEntrypoint = process.argv[1]
  process.argv[1] = entrypoint
  try {
    await expect(spawnDetachedRunner({
      configPath: path.join(workspace, 'harness.ts'),
      runId: 'short-lived-worker',
      workspaceDir: workspace,
      timeoutMs: 1000,
    })).rejects.toThrow('failed to initialize')
  }
  finally { process.argv[1] = priorEntrypoint }
})

it('does not accept initialization files written with a different PID', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'ludd-pid-mismatch-'))
  dirs.push(workspace)
  const entrypoint = path.join(workspace, 'mismatched-worker.js')
  fs.writeFileSync(entrypoint, `import fs from 'node:fs'; import path from 'node:path'; const args = process.argv.slice(2); const get = key => args[args.indexOf(key) + 1]; const dir = path.join(get('--workspace'), '.harness', 'runs', get('--run-id')); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'runner.pid'), '1'); fs.writeFileSync(path.join(dir, 'state.json'), '{}');\n`)
  const priorEntrypoint = process.argv[1]
  process.argv[1] = entrypoint
  try {
    await expect(spawnDetachedRunner({
      configPath: path.join(workspace, 'harness.ts'),
      runId: 'pid-mismatch',
      workspaceDir: workspace,
      timeoutMs: 150,
    })).rejects.toThrow('failed to initialize')
  }
  finally { process.argv[1] = priorEntrypoint }
})
