import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { bootstrapCli, main, runCli } from './bin.js'

const commands = vi.hoisted(() => ({
  run: vi.fn(async () => 0),
  resume: vi.fn(async () => 0),
  status: vi.fn(async () => 0),
  abort: vi.fn(async () => 0),
  teardown: vi.fn(async () => 0),
  gc: vi.fn(async () => 0),
  gate: vi.fn(async () => 0),
}))

vi.mock('./commands/run-command.js', () => ({ runCommand: commands.run }))
vi.mock('./commands/resume-command.js', () => ({ resumeCommand: commands.resume }))
vi.mock('./commands/status-command.js', () => ({ statusCommand: commands.status }))
vi.mock('./commands/abort-command.js', () => ({ abortCommand: commands.abort }))
vi.mock('./commands/teardown-command.js', () => ({ teardownCommand: commands.teardown }))
vi.mock('./commands/gc-command.js', () => ({ gcCommand: commands.gc }))
vi.mock('./commands/gate-command.js', () => ({ gateCommand: commands.gate }))

const originalArgv = process.argv
const originalExitCode = process.exitCode

function args(...argv: string[]): void {
  process.argv = [
    'node',
    path.resolve('packages/cli/src/bin.ts'),
    ...argv,
  ]
  process.exitCode = undefined
}

afterEach(() => {
  process.argv = originalArgv
  process.exitCode = originalExitCode
  vi.clearAllMocks()
})

it('rejects invocation without a command', async () => {
  args()
  await expect(main()).rejects.toThrow('Usage: ludd run')
})

it('dispatches internal workers to run or resume depending on persisted state', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'ludd-worker-'))
  try {
    args('__worker', '--config', 'flow.ts', '--run-id', 'new', '--workspace', workspace)
    await main()
    expect(commands.run).toHaveBeenCalledWith({
      runId: 'new',
      workspace,
      configPath: 'flow.ts',
      worker: true,
    })
    fs.mkdirSync(path.join(workspace, '.harness', 'runs', 'old'), { recursive: true })
    fs.writeFileSync(path.join(workspace, '.harness', 'runs', 'old', 'state.json'), '{}')
    args('__worker', '--config', 'flow.ts', '--run-id', 'old', '--workspace', workspace)
    await main()
    expect(commands.resume).toHaveBeenCalledWith({ runId: 'old', workspace, worker: true })
  }
  finally { fs.rmSync(workspace, { recursive: true, force: true }) }
})

it('rejects malformed internal worker arguments', async () => {
  args('__worker', '--run-id', 'missing-other-flags')
  await expect(main()).rejects.toThrow('Invalid internal worker arguments.')
})

it('dispatches foreground and detached run options from positional and named configs', async () => {
  args('run', 'flow.ts', '--run-id', 'run-a', '--workspace', '/tmp/work', '--stream', '--detach')
  await main()
  expect(commands.run).toHaveBeenCalledWith({
    configPath: 'flow.ts',
    runId: 'run-a',
    workspace: '/tmp/work',
    stream: true,
    detach: true,
  })
  args('run', '-c', 'other.ts')
  await main()
  expect(commands.run).toHaveBeenLastCalledWith({ configPath: 'other.ts' })
  args('run')
  await main()
  expect(commands.run).toHaveBeenLastCalledWith({})
})

it('rejects conflicting run config forms and excess positionals', async () => {
  args('run', 'first.ts', 'second.ts')
  await expect(main()).rejects.toThrow('Usage: ludd run')
  args('run', 'first.ts', '--config', 'second.ts')
  await expect(main()).rejects.toThrow('Usage: ludd run')
})

it('dispatches resume and rejects missing IDs and config flags', async () => {
  args('resume', 'run-a', '--workspace', '/tmp/work', '--stream', '--detach')
  await main()
  expect(commands.resume).toHaveBeenCalledWith({
    runId: 'run-a',
    workspace: '/tmp/work',
    stream: true,
    detach: true,
  })
  args('resume', 'run-b')
  await main()
  expect(commands.resume).toHaveBeenLastCalledWith({ runId: 'run-b' })
  args('resume')
  await expect(main()).rejects.toThrow('Usage: ludd resume')
  args('resume', 'run-a', '--config', 'flow.ts')
  await expect(main()).rejects.toThrow()
})

it('dispatches status list and details, rejecting extra IDs', async () => {
  args('status', '--workspace', '/tmp/work', '--json')
  await main()
  expect(commands.status).toHaveBeenCalledWith({ workspace: '/tmp/work', json: true })
  args('status', 'run-a')
  await main()
  expect(commands.status).toHaveBeenLastCalledWith({ runId: 'run-a' })
  args('status', 'run-a', 'run-b')
  await expect(main()).rejects.toThrow('Usage: ludd status')
})

it('dispatches abort options and validates the positional run ID', async () => {
  args('abort', 'run-a', '--workspace', '/tmp/work', '--reason', 'Stop', '--teardown')
  await main()
  expect(commands.abort).toHaveBeenCalledWith({
    runId: 'run-a',
    workspace: '/tmp/work',
    reason: 'Stop',
    teardown: true,
  })
  args('abort', 'run-b')
  await main()
  expect(commands.abort).toHaveBeenLastCalledWith({ runId: 'run-b' })
  args('abort')
  await expect(main()).rejects.toThrow('Usage: ludd abort')
})

it('dispatches teardown options and validates its run ID', async () => {
  args('teardown', 'run-a', '--workspace', '/tmp/work', '--force')
  await main()
  expect(commands.teardown).toHaveBeenCalledWith({ runId: 'run-a', workspace: '/tmp/work', force: true })
  args('teardown', 'run-b')
  await main()
  expect(commands.teardown).toHaveBeenLastCalledWith({ runId: 'run-b' })
  args('teardown')
  await expect(main()).rejects.toThrow('Usage: ludd teardown')
})

it('combines positional and repeated GC filters', async () => {
  args('gc', 'run-a', '--workspace', '/tmp/work', '--run-id', 'run-b', '--run-id', 'run-c', '--older-than', '2h', '--status', 'passed', '--status', 'failed', '--dry-run')
  await main()
  expect(commands.gc).toHaveBeenCalledWith({
    runId: ['run-a', 'run-b', 'run-c'],
    workspace: '/tmp/work',
    olderThan: '2h',
    status: ['passed', 'failed'],
    dryRun: true,
  })
  args('gc')
  await main()
  expect(commands.gc).toHaveBeenLastCalledWith({})
})

it('dispatches gate actions, optional retries, and interactive mode', async () => {
  args('gate', 'run-a', '--workspace', '/tmp/work', '--action', 'retry', '--feedback', 'More', '--add-retries', '2')
  await main()
  expect(commands.gate).toHaveBeenCalledWith({
    runId: 'run-a',
    workspace: '/tmp/work',
    action: 'retry',
    feedback: 'More',
    addRetries: 2,
  })
  args('gate', 'run-a')
  await main()
  expect(commands.gate).toHaveBeenLastCalledWith({ runId: 'run-a' })
  args('gate')
  await expect(main()).rejects.toThrow('Usage: ludd gate')
  args('gate', 'run-a', '--action', 'unknown')
  await expect(main()).rejects.toThrow('Usage: ludd gate')
  args('gate', 'run-a', '--add-retries', '0')
  await expect(main()).rejects.toThrow('--add-retries must be a positive integer')
})

it('reports unknown commands and turns thrown errors into a nonzero CLI exit', async () => {
  args('unknown')
  await expect(main()).rejects.toThrow('Usage: ludd run')
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  commands.run.mockRejectedValueOnce(new Error('command failed'))
  args('run')
  await runCli()
  expect(error).toHaveBeenCalledWith('command failed')
  expect(process.exitCode).toBe(1)
  commands.run.mockRejectedValueOnce('non-error rejection')
  args('run')
  await runCli()
  expect(error).toHaveBeenLastCalledWith('non-error rejection')
  error.mockRestore()
})

it('only bootstraps when invoked through the CLI entrypoint', async () => {
  await bootstrapCli()
  expect(commands.run).not.toHaveBeenCalled()
  args('run')
  await bootstrapCli(path.resolve('packages/cli/src/bin.ts'))
  expect(commands.run).toHaveBeenCalledWith({})
})
