import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { afterEach, expect, it, vi } from 'vitest'
import { bootstrapCli, main, runCli } from './bin.js'

const mocks = vi.hoisted(() => ({
  pastelRun: vi.fn(async (_argv?: string[]) => {}),
  pastelCtor: vi.fn(),
  run: vi.fn(async () => 0),
  resume: vi.fn(async () => 0),
}))

vi.mock('pastel', () => ({
  default: class FakePastel {
    constructor(opts: unknown) {
      mocks.pastelCtor(opts)
    }

    async run(argv?: string[]) {
      return mocks.pastelRun(argv)
    }
  },
}))
vi.mock('./actions/run-command.js', () => ({ runCommand: mocks.run }))
vi.mock('./actions/resume-command.js', () => ({ resumeCommand: mocks.resume }))

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

it('delegates regular commands to Pastel', async () => {
  args('run', 'flow.ts')
  await main()
  expect(mocks.pastelCtor).toHaveBeenCalledWith(expect.objectContaining({
    name: 'ludd',
    description: 'Agentic workflow harness CLI',
  }))
  expect(mocks.pastelRun).toHaveBeenCalledWith(process.argv)
})

it('dispatches internal workers to run or resume depending on persisted state', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'ludd-worker-'))
  try {
    args('__worker', '--config', 'flow.ts', '--run-id', 'new', '--workspace', workspace)
    await main()
    expect(mocks.run).toHaveBeenCalledWith({
      runId: 'new',
      workspace,
      configPath: 'flow.ts',
      worker: true,
    })
    fs.mkdirSync(path.join(workspace, '.harness', 'runs', 'old'), { recursive: true })
    fs.writeFileSync(path.join(workspace, '.harness', 'runs', 'old', 'state.json'), '{}')
    args('__worker', '--config', 'flow.ts', '--run-id', 'old', '--workspace', workspace)
    await main()
    expect(mocks.resume).toHaveBeenCalledWith({ runId: 'old', workspace, worker: true })
  }
  finally { fs.rmSync(workspace, { recursive: true, force: true }) }
})

it('rejects malformed internal worker arguments', async () => {
  args('__worker', '--run-id', 'missing-other-flags')
  await expect(main()).rejects.toThrow('Invalid internal worker arguments.')
})

it('turns thrown errors into a nonzero CLI exit', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  mocks.pastelRun.mockRejectedValueOnce(new Error('command failed'))
  args('run')
  await runCli()
  expect(error).toHaveBeenCalledWith('command failed')
  expect(process.exitCode).toBe(1)
  mocks.pastelRun.mockRejectedValueOnce('non-error rejection')
  args('run')
  await runCli()
  expect(error).toHaveBeenLastCalledWith('non-error rejection')
  error.mockRestore()
})

it('only bootstraps when invoked through the CLI entrypoint', async () => {
  await bootstrapCli()
  expect(mocks.pastelRun).not.toHaveBeenCalled()
  args('status')
  await bootstrapCli(path.resolve('packages/cli/src/bin.ts'))
  expect(mocks.pastelRun).toHaveBeenCalledOnce()
})

it('runs when invoked through a symlink pointing to the bin entrypoint', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ludd-bin-test-'))
  try {
    const symlinkPath = path.join(dir, 'ludd')
    fs.symlinkSync(path.resolve('packages/cli/src/bin.ts'), symlinkPath)
    args('status')
    await bootstrapCli(symlinkPath)
    expect(mocks.pastelRun).toHaveBeenCalledOnce()
  }
  finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

it('does not run and falls back cleanly for a non-existent entrypoint path', async () => {
  args('status')
  await bootstrapCli('/non-existent/path/to/ludd')
  expect(mocks.pastelRun).not.toHaveBeenCalled()
})
