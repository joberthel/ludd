import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
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
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('statusCommand', () => {
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
})
