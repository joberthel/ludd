import type { ControlClient, RunStateSnapshot } from '@ludd/core'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { RunAlreadyActiveError } from '@ludd/core'
import { afterEach, expect, it, vi } from 'vitest'
import { resumeCommand } from './resume-command.js'

const prompt = vi.hoisted(() => vi.fn())
const detachedRunner = vi.hoisted(() => vi.fn(async () => 0))
vi.mock('../prompts/inline-gate-prompter.js', () => ({ promptForGate: prompt }))
vi.mock('../daemon/spawn-detached-runner.js', () => ({ spawnDetachedRunner: detachedRunner }))

const directories: string[] = []
function validState(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    runId: 'run-1',
    harnessName: 'resume-test',
    workflowName: 'resume-test',
    configPath: 'harness.config.ts',
    status: 'failed',
    activeStepId: 'step',
    activeGate: null,
    activeSessionId: null,
    activeStepAttempt: 1,
    activeMatrixIndex: null,
    activeMatrixOutputs: [],
    steps: {},
    updatedAt: new Date().toISOString(),
    ...overrides,
  }
}

function setup(state?: Record<string, unknown>): string {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'ludd-resume-'))
  directories.push(workspace)
  fs.writeFileSync(path.join(workspace, 'harness.config.ts'), `import { defineHarness } from '@ludd/core'\nexport default defineHarness({ name: 'resume-test', steps: [{ id: 'step', run: async () => ({ ok: true }) }] })\n`)
  if (state) {
    const runDir = path.join(workspace, '.harness', 'runs', 'run-1')
    fs.mkdirSync(runDir, { recursive: true })
    fs.writeFileSync(path.join(runDir, 'state.json'), JSON.stringify(state))
  }
  return workspace
}

afterEach(() => {
  prompt.mockReset()
  detachedRunner.mockClear()
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true })
})

it('fails with RunNotFoundError when persisted state is absent', async () => {
  const workspace = setup()
  await expect(resumeCommand({ runId: 'missing', workspace })).rejects.toMatchObject({ name: 'RunNotFoundError', runId: 'missing' })
})

it('loads the persisted config path and resumes an inactive run', async () => {
  const workspace = setup(validState({ configPath: 'stored.config.ts' }))
  fs.writeFileSync(path.join(workspace, 'stored.config.ts'), `import { defineHarness } from '@ludd/core'\nexport default defineHarness({ name: 'resume-test', steps: [{ id: 'step', run: async () => ({ ok: true }) }] })\n`)
  await expect(resumeCommand({ runId: 'run-1', workspace })).resolves.toBe(0)
  expect(JSON.parse(fs.readFileSync(path.join(workspace, '.harness/runs/run-1/state.json'), 'utf8')).status).toBe('passed')
})

it('rejects a config override', async () => {
  const workspace = setup(validState())
  await expect(resumeCommand({ runId: 'run-1', workspace, configPath: 'other.ts' })).rejects.toThrow(/does not accept --config/)
})

it('reports success when the run state is already passed', async () => {
  const workspace = setup(validState({ status: 'passed' }))
  const log = vi.spyOn(console, 'log').mockImplementation(() => {})
  try {
    await expect(resumeCommand({ runId: 'run-1', workspace })).resolves.toBe(0)
    expect(log).toHaveBeenCalledWith('Run run-1 has already completed (status: passed)')
  }
  finally {
    log.mockRestore()
  }
})

it('throws RunAlreadyActiveError with the run ID and active runner PID', async () => {
  const workspace = setup(validState())
  fs.writeFileSync(path.join(workspace, '.harness/runs/run-1/runner.pid'), `${process.pid}\n`)
  const error = await resumeCommand({ runId: 'run-1', workspace }).catch(error => error)
  expect(error).toBeInstanceOf(RunAlreadyActiveError)
  expect(error).toMatchObject({ runId: 'run-1', pid: process.pid })
})

it('resumes a stale PID and returns failure when the workflow fails', async () => {
  const workspace = setup(validState())
  fs.writeFileSync(path.join(workspace, '.harness/runs/run-1/runner.pid'), '999999\n')
  fs.writeFileSync(path.join(workspace, 'harness.config.ts'), `import { defineHarness } from '@ludd/core'\nexport default defineHarness({ name: 'resume-test', steps: [{ id: 'step', run: async () => { throw new Error('workflow failed') } }] })\n`)
  await expect(resumeCommand({ runId: 'run-1', workspace })).resolves.toBe(1)
})

it('uses the default harness.config.ts when configPath is absent', async () => {
  const workspace = setup(validState({ configPath: undefined }))
  await expect(resumeCommand({ runId: 'run-1', workspace })).resolves.toBe(0)
})

it('uses programmatic detached startup for an inactive run', async () => {
  const workspace = setup(validState({ configPath: 'stored.config.ts' }))
  fs.writeFileSync(path.join(workspace, 'stored.config.ts'), `export default { name: 'resume-test', steps: [{ id: 'step', run: async () => ({ ok: true }) }] }\n`)
  await expect(resumeCommand({ runId: 'run-1', workspace, detach: true })).resolves.toBe(0)
  expect(detachedRunner).toHaveBeenCalledWith({
    configPath: path.join(workspace, 'stored.config.ts'),
    runId: 'run-1',
    workspaceDir: workspace,
  })
})

it('attaches to and resolves a waiting gate while resuming in foreground', async () => {
  const workspace = setup(validState({ configPath: 'gate.config.ts' }))
  fs.writeFileSync(path.join(workspace, 'gate.config.ts'), `import { defineHarness } from '@ludd/core'\nconst review = { __kind: 'guardrail', type: 'human_review', prompt: 'Resume review?', execute: async () => ({ status: 'pass', body: 'ok' }) }\nexport default defineHarness({ name: 'resume-test', steps: [{ id: 'step', run: async () => ({ ok: true }), beforeStep: [review] }] })\n`)
  prompt.mockImplementation(async (rawState: unknown, rawClient: unknown) => {
    const gate = (rawState as RunStateSnapshot).activeGate!
    await (rawClient as ControlClient).resolveGate({ stepId: gate.stepId, guardrailIndex: gate.guardrailIndex, action: 'pass' })
  })
  await expect(resumeCommand({ runId: 'run-1', workspace, stream: true })).resolves.toBe(0)
  expect(prompt).toHaveBeenCalledOnce()
  expect(JSON.parse(fs.readFileSync(path.join(workspace, '.harness', 'runs', 'run-1', 'state.json'), 'utf8')).status).toBe('passed')
})

it('resumes using the default config path when no persisted path or workspace option exists', async () => {
  const cwd = vi.spyOn(process, 'cwd').mockReturnValue('/tmp/ludd-resume-default')
  const runDir = path.join('/tmp/ludd-resume-default', '.harness', 'runs', 'run-1')
  fs.mkdirSync(runDir, { recursive: true })
  fs.writeFileSync(path.join(runDir, 'state.json'), JSON.stringify(validState({ status: 'passed', configPath: undefined })))
  const log = vi.spyOn(console, 'log').mockImplementation(() => {})
  try {
    await expect(resumeCommand({ runId: 'run-1' })).resolves.toBe(0)
    expect(log).toHaveBeenCalledWith('Run run-1 has already completed (status: passed)')
  }
  finally {
    cwd.mockRestore()
    log.mockRestore()
    fs.rmSync('/tmp/ludd-resume-default', { recursive: true, force: true })
  }
})
