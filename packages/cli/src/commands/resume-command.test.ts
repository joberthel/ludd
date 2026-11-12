import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { RunAlreadyActiveError } from '@ludd/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resumeCommand } from './resume-command.js'

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
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true })
})

describe('resumeCommand', () => {
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

  it('uses the default harness.config.ts when configPath is absent', async () => {
    const workspace = setup(validState({ configPath: undefined }))
    await expect(resumeCommand({ runId: 'run-1', workspace })).resolves.toBe(0)
  })
})
