import type { ControlClient } from '../../types/ipc.js'
import type { RunStateSnapshot } from '../../types/state.js'
import fs from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { humanReviewGuardrail } from '@luddjs/guardrails'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createControlClient } from '../../ipc/control-client.js'
import { readLedgerEvents } from '../../persistence/ledger-writer.js'
import { RUNNER_PID_FILE } from '../../persistence/pid-lock.js'
import { readRunState } from '../../persistence/state-store.js'
import { spawn } from '../host-exec.js'
import { runHarness } from '../run-harness.js'

let tempDir: string

beforeEach(async () => {
  const baseDir = process.platform === 'win32'
    ? os.tmpdir()
    : '/tmp'
  tempDir = await mkdtemp(path.join(baseDir, 'ludd-abort-td-'))
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

async function waitForRunState(
  runDir: string,
  predicate: (state: RunStateSnapshot) => boolean,
): Promise<ControlClient> {
  for (let i = 0; i < 50; i++) {
    try {
      const client = await createControlClient(runDir)
      const state = await client.status()
      if (predicate(state)) {
        return client
      }
      await client.close()
    }
    catch {
      // Socket not ready yet
    }
    await new Promise(r => setTimeout(r, 50))
  }
  throw new Error('Timeout waiting for target run state in control server')
}

describe('run.abort RPC method while waiting at gate (AC 6.6.1)', () => {
  it('aborts waiting gate immediately, invokes teardown hook, and records status failed', async () => {
    const runId = 'abort-at-gate'
    const runDir = path.join(tempDir, '.harness', 'runs', runId)
    const hookTeardown = vi.fn().mockResolvedValue(undefined)

    const runPromise = runHarness(
      {
        name: 'gate-abort-pipeline',
        teardown: hookTeardown,
        steps: [
          {
            id: 'gate-step',
            beforeStep: [
              humanReviewGuardrail({ prompt: 'Approve before continuing:' }),
            ],
            run: async () => 'ok',
          },
        ],
      },
      { runId, workspaceDir: tempDir },
    )

    const client = await waitForRunState(runDir, s => s.status === 'waiting_for_gate' && Boolean(s.activeGate))
    const abortResult = await client.abort({ reason: 'User canceled at gate', teardown: true })
    expect(abortResult.ok).toBe(true)
    await client.close()

    const result = await runPromise
    expect(result.status).toBe('failed')
    expect(hookTeardown).toHaveBeenCalledTimes(1)

    const state = readRunState(runDir)
    expect(state.status).toBe('failed')
    expect(state.activeGate).toBeNull()

    const events = readLedgerEvents(runDir)
    const failedEvent = events.find(e => e.eventType === 'run.failed')
    expect(failedEvent?.payload.error).toBe('User canceled at gate')
    expect(fs.existsSync(path.join(runDir, RUNNER_PID_FILE))).toBe(false)
  })
})

describe('run.abort RPC method while executing command (AC 6.6.1)', () => {
  it('aborts running command immediately, kills child process, runs harness teardown, records status failed', async () => {
    const runId = 'abort-running-cmd'
    const runDir = path.join(tempDir, '.harness', 'runs', runId)
    const hookTeardown = vi.fn().mockResolvedValue(undefined)

    const runPromise = runHarness(
      {
        name: 'cmd-abort-pipeline',
        teardown: hookTeardown,
        steps: [
          {
            id: 'long-cmd-step',
            run: {
              __kind: 'agent',
              mode: 'workspace-write',
              prompt: 'wait',
              executeTurn: async (input) => {
                const res = await spawn({
                  command: process.execPath,
                  args: ['-e', 'setInterval(() => {}, 1000)'],
                  cwd: input.cwd,
                  env: input.env,
                  signal: input.signal,
                })
                return { output: res, sessionId: input.sessionId }
              },
            },
          },
        ],
      },
      { runId, workspaceDir: tempDir },
    )

    const client = await waitForRunState(runDir, s => s.status === 'running' && s.activeStepId === 'long-cmd-step')
    const abortResult = await client.abort({ reason: 'Command interrupted by user', teardown: true })
    expect(abortResult.ok).toBe(true)
    await client.close()

    const result = await runPromise
    expect(result.status).toBe('failed')
    expect(hookTeardown).toHaveBeenCalledTimes(1)

    const state = readRunState(runDir)
    expect(state.status).toBe('failed')

    const events = readLedgerEvents(runDir)
    const failedEvent = events.find(e => e.eventType === 'run.failed')
    expect(failedEvent?.payload.error).toBe('Command interrupted by user')
    expect(fs.existsSync(path.join(runDir, RUNNER_PID_FILE))).toBe(false)
  })
})

describe('run.abort RPC method without teardown', () => {
  it('aborts without emitting run.teardown when teardown flag is false', async () => {
    const runId = 'abort-no-teardown'
    const runDir = path.join(tempDir, '.harness', 'runs', runId)

    const runPromise = runHarness(
      {
        name: 'abort-keep-pipeline',
        steps: [
          {
            id: 'gate-step',
            beforeStep: [
              humanReviewGuardrail({ prompt: 'Review me:' }),
            ],
            run: async () => 'ok',
          },
        ],
      },
      { runId, workspaceDir: tempDir },
    )

    const client = await waitForRunState(runDir, s => s.status === 'waiting_for_gate' && Boolean(s.activeGate))
    await client.abort({ reason: 'Cancel only', teardown: false })
    await client.close()

    const result = await runPromise
    expect(result.status).toBe('failed')
    expect(readLedgerEvents(runDir).some(e => e.eventType === 'run.teardown')).toBe(false)
  })
})

describe('run.teardown RPC method on live runner', () => {
  it('invokes harness teardown hook via IPC run.teardown once without duplicating on abort', async () => {
    const runId = 'live-teardown-hook'
    const runDir = path.join(tempDir, '.harness', 'runs', runId)
    const hookTeardown = vi.fn().mockResolvedValue(undefined)

    const runPromise = runHarness(
      {
        name: 'live-td-hook-pipeline',
        teardown: hookTeardown,
        steps: [
          {
            id: 'gate-step',
            beforeStep: [
              humanReviewGuardrail({ prompt: 'Wait before teardown:' }),
            ],
            run: async () => 'ok',
          },
        ],
      },
      { runId, workspaceDir: tempDir },
    )

    const client = await waitForRunState(runDir, s => s.status === 'waiting_for_gate' && Boolean(s.activeGate))
    const tdResult = await client.teardown({ force: true })
    expect(tdResult.ok).toBe(true)
    expect(hookTeardown).toHaveBeenCalledTimes(1)

    await client.abort({ reason: 'Finished after hook teardown' })
    await client.close()
    const result = await runPromise
    expect(result.status).toBe('failed')
    expect(hookTeardown).toHaveBeenCalledTimes(1)

    const tdEvents = readLedgerEvents(runDir).filter(e => e.eventType === 'run.teardown')
    expect(tdEvents.map(e => e.payload)).toEqual([
      { hookInvoked: true, forced: true },
    ])
  })

  it('deduplicates concurrent IPC run.teardown and run.abort, and resets on failure', async () => {
    const runId = 'concurrent-teardown-abort'
    const runDir = path.join(tempDir, '.harness', 'runs', runId)
    let releaseTeardown!: () => void
    const teardownGate = new Promise<void>((resolve) => {
      releaseTeardown = resolve
    })
    let callCount = 0
    const hookTeardown = vi.fn(async (ctx) => {
      callCount++
      expect(ctx.signal.aborted).toBe(false)
      if (callCount === 1) {
        await teardownGate
      }
    })

    const runPromise = runHarness(
      {
        name: 'concurrent-td-pipeline',
        teardown: hookTeardown,
        steps: [
          {
            id: 'gate-step',
            beforeStep: [
              humanReviewGuardrail({ prompt: 'Hold for concurrent teardown:' }),
            ],
            run: async () => 'ok',
          },
        ],
      },
      { runId, workspaceDir: tempDir },
    )

    const client = await waitForRunState(runDir, s => s.status === 'waiting_for_gate' && Boolean(s.activeGate))
    const tdPromise = client.teardown({ force: true })
    await vi.waitFor(() => expect(hookTeardown).toHaveBeenCalledTimes(1))

    // Trigger abort while IPC teardown is still in-flight; abort awaits the same promise.
    const abortPromise = client.abort({ reason: 'Concurrent abort' })
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(hookTeardown).toHaveBeenCalledTimes(1)

    releaseTeardown()
    const [tdResult, abortResult] = await Promise.all([tdPromise, abortPromise])
    expect(tdResult.ok).toBe(true)
    expect(abortResult.ok).toBe(true)
    await client.close()

    const result = await runPromise
    expect(result.status).toBe('failed')
    expect(hookTeardown).toHaveBeenCalledTimes(1)
  })

  it('allows shutdown teardown to retry if prior IPC run.teardown failed, and skips second IPC teardown after success', async () => {
    const runId = 'retry-after-td-failure'
    const runDir = path.join(tempDir, '.harness', 'runs', runId)
    let attempts = 0
    const hookTeardown = vi.fn(async (ctx) => {
      attempts++
      expect(ctx.signal.aborted).toBe(false)
      const res = await spawn({
        command: process.execPath,
        args: ['-e', 'process.exit(0)'],
        cwd: ctx.workspaceRoot,
        signal: ctx.signal,
      })
      expect(res.exitCode).toBe(0)
      if (attempts === 1) {
        throw new Error('transient teardown failure')
      }
    })

    const runPromise = runHarness(
      {
        name: 'retry-td-pipeline',
        teardown: hookTeardown,
        steps: [
          {
            id: 'gate-step',
            beforeStep: [
              humanReviewGuardrail({ prompt: 'Hold for retry test:' }),
            ],
            run: async () => 'ok',
          },
        ],
      },
      { runId, workspaceDir: tempDir },
    )

    const client = await waitForRunState(runDir, s => s.status === 'waiting_for_gate' && Boolean(s.activeGate))
    await expect(client.teardown()).rejects.toThrow('transient teardown failure')
    expect(hookTeardown).toHaveBeenCalledTimes(1)

    // Retry IPC teardown succeeds, and subsequent IPC teardown records hookInvoked: false.
    await expect(client.teardown()).resolves.toEqual({ ok: true })
    await expect(client.teardown()).resolves.toEqual({ ok: true })
    expect(hookTeardown).toHaveBeenCalledTimes(2)

    await client.abort({ reason: 'Done after retry' })
    await client.close()
    await runPromise
    expect(hookTeardown).toHaveBeenCalledTimes(2)

    const tdEvents = readLedgerEvents(runDir).filter(e => e.eventType === 'run.teardown')
    expect(tdEvents.map(e => e.payload)).toEqual([
      { hookInvoked: true, forced: false },
      { hookInvoked: false, forced: false },
    ])
  })
})

describe('run.abort pipeline interruption between steps', () => {
  it('stops pipeline execution immediately when aborted between steps', async () => {
    const runId = 'abort-between-steps'
    const runDir = path.join(tempDir, '.harness', 'runs', runId)
    let step2Executed = false

    const result = await runHarness(
      {
        name: 'two-step-abort-pipeline',
        steps: [
          {
            id: 'step-1',
            run: async () => {
              const client = await createControlClient(runDir)
              await client.abort({ reason: 'Cancel before step 2' })
              await client.close()
              return 'step1-ok'
            },
          },
          {
            id: 'step-2',
            run: async () => {
              step2Executed = true
              return 'step2-ok'
            },
          },
        ],
      },
      { runId, workspaceDir: tempDir },
    )

    expect(result.status).toBe('failed')
    expect(result.steps['step-1']?.status).toBe('passed')
    expect(result.steps['step-2']).toBeUndefined()
    expect(step2Executed).toBe(false)
  })
})
