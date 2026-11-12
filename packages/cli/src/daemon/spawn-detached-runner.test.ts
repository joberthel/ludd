import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { afterEach, describe, expect, it } from 'vitest'
import { spawnDetachedRunner } from './spawn-detached-runner.js'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('spawnDetachedRunner', () => {
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
        timeoutMs: 2000,
      })).resolves.toBe(0)
      const pid = Number(fs.readFileSync(path.join(workspace, '.harness/runs/background/runner.pid'), 'utf8'))
      expect(pid).toBeGreaterThan(0)
      process.kill(pid, 'SIGTERM')
    }
    finally { process.argv[1] = priorEntrypoint }
  })
})
