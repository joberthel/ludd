import type { RunStateSnapshot } from '@ludd/core'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { startControlServer } from '@ludd/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { gateCommand } from './gate-command.js'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('gateCommand', () => {
  it('resolves a gate through the control socket', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'ludd-gate-'))
    dirs.push(workspace)
    const runDir = path.join(workspace, '.harness', 'runs', 'gate-run')
    const snapshot = {
      schemaVersion: 1,
      runId: 'gate-run',
      harnessName: 'workflow',
      workflowName: 'workflow',
      status: 'waiting_for_gate',
      activeStepId: 'review',
      activeGate: {
        stepId: 'review',
        phase: 'afterStep',
        guardrailIndex: 2,
        gateType: 'human_review',
        prompt: 'Approve?',
        createdAt: new Date().toISOString(),
      },
      steps: {},
      updatedAt: new Date().toISOString(),
    } as RunStateSnapshot
    let resolution: unknown
    const server = await startControlServer(runDir, {
      getStatus: () => snapshot,
      resolveGate: (params) => {
        resolution = params
        return { ok: true }
      },
    })
    try {
      await expect(gateCommand({
        runId: 'gate-run',
        workspace,
        action: 'pass',
        feedback: 'Approved',
      })).resolves.toBe(0)
      expect(resolution).toEqual({
        stepId: 'review',
        guardrailIndex: 2,
        action: 'pass',
        feedback: 'Approved',
      })
    }
    finally { await server.close() }
  })

  it('returns failure when the run is not waiting at a gate', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'ludd-gate-'))
    dirs.push(workspace)
    const runDir = path.join(workspace, '.harness', 'runs', 'gate-run')
    const snapshot = { runId: 'gate-run', status: 'running', activeGate: null } as RunStateSnapshot
    const server = await startControlServer(runDir, {
      getStatus: () => snapshot,
    })
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await expect(gateCommand({ runId: 'gate-run', workspace, action: 'pass' })).resolves.toBe(1)
      expect(error).toHaveBeenCalledWith('Run gate-run is not currently waiting at a gate')
    }
    finally {
      error.mockRestore()
      await server.close()
    }
  })
})
