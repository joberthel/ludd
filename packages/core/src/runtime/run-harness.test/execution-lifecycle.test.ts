import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readLedgerEvents } from '../../persistence/ledger-writer.js'
import { readRunState, resolveRunDir } from '../../persistence/state-store.js'
import { runHarness } from '../run-harness.js'

let tempDir: string

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-exec-life-'))
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

describe('runHarness setup and teardown error handling', () => {
  it('runs teardown on step failure and preserves step failure if teardown also throws', async () => {
    const teardownOnStepFail = vi.fn(async () => {})
    const res1 = await runHarness({
      name: 'step-fail-teardown',
      teardown: teardownOnStepFail,
      steps: [
        {
          id: 'boom',
          run: () => {
            throw new Error('step failure')
          },
        },
      ],
    }, { runId: 'r-step-fail', workspaceDir: tempDir })
    expect(res1.status).toBe('failed')
    expect((res1.error as Error).message).toBe('step failure')
    expect(teardownOnStepFail).toHaveBeenCalledTimes(1)

    const teardownThrowing = vi.fn(async () => {
      throw new Error('secondary teardown boom')
    })
    const res2 = await runHarness({
      name: 'step-and-teardown-fail',
      teardown: teardownThrowing,
      steps: [
        {
          id: 'boom',
          run: () => {
            throw new Error('primary step boom')
          },
        },
      ],
    }, { runId: 'r-both-fail', workspaceDir: tempDir })
    expect(res2.status).toBe('failed')
    expect((res2.error as Error).message).toBe('primary step boom')
    expect(teardownThrowing).toHaveBeenCalledTimes(1)
  })

  it('runs teardown when setup throws, persists failed state, and rethrows primary error', async () => {
    const teardownSpy = vi.fn(async () => {})
    const stepSpy = vi.fn()

    await expect(runHarness({
      name: 'setup-fail',
      setup: async () => {
        throw new Error('setup exploded')
      },
      teardown: teardownSpy,
      steps: [
        { id: 's1', run: stepSpy },
      ],
    }, { runId: 'r-setup-fail', workspaceDir: tempDir })).rejects.toThrow('setup exploded')

    expect(teardownSpy).toHaveBeenCalledTimes(1)
    expect(stepSpy).not.toHaveBeenCalled()
    const runDir = resolveRunDir(tempDir, 'r-setup-fail')
    expect(readRunState(runDir).status).toBe('failed')
    expect(readLedgerEvents(runDir).some(e => e.eventType === 'run.failed')).toBe(true)
  })

  it('persists failed state and rejects when teardown throws after passing steps', async () => {
    await expect(runHarness({
      name: 'teardown-fail-only',
      teardown: async () => {
        throw new Error('teardown exploded')
      },
      steps: [
        {
          id: 's1',
          run: () => 'ok',
        },
      ],
    }, { runId: 'r-td-fail', workspaceDir: tempDir })).rejects.toThrow('teardown exploded')

    const runDir = resolveRunDir(tempDir, 'r-td-fail')
    expect(readRunState(runDir).status).toBe('failed')
    const events = readLedgerEvents(runDir)
    expect(events.some(e => e.eventType === 'run.passed')).toBe(false)
    const failed = events.find(e => e.eventType === 'run.failed')
    expect(failed?.payload.error).toBe('teardown exploded')
  })
})

describe('runHarness AbortSignal teardown lifecycle', () => {
  it('guarantees teardown on pre-aborted signal and mid-setup abort without running steps', async () => {
    const preCtrl = new AbortController()
    preCtrl.abort(new Error('pre-aborted-reason'))
    const preSetupSpy = vi.fn()
    const preTeardownSpy = vi.fn()
    const preStepSpy = vi.fn()

    const preRes = await runHarness({
      name: 'pre-abort-life',
      setup: preSetupSpy,
      teardown: preTeardownSpy,
      steps: [
        { id: 's1', run: preStepSpy },
      ],
    }, { runId: 'r-pre-abort', workspaceDir: tempDir, signal: preCtrl.signal })

    expect(preRes.status).toBe('failed')
    expect(preSetupSpy).not.toHaveBeenCalled()
    expect(preStepSpy).not.toHaveBeenCalled()
    expect(preTeardownSpy).toHaveBeenCalledTimes(1)
    expect(readRunState(resolveRunDir(tempDir, 'r-pre-abort')).status).toBe('failed')

    const midCtrl = new AbortController()
    const midTeardownSpy = vi.fn()
    const midStepSpy = vi.fn()
    const midRes = await runHarness({
      name: 'mid-setup-abort-life',
      setup: () => {
        midCtrl.abort('cancelled-during-setup')
      },
      teardown: midTeardownSpy,
      steps: [
        { id: 's1', run: midStepSpy },
      ],
    }, { runId: 'r-mid-abort', workspaceDir: tempDir, signal: midCtrl.signal })

    expect(midRes.status).toBe('failed')
    expect(midRes.error).toBe('cancelled-during-setup')
    expect(midStepSpy).not.toHaveBeenCalled()
    expect(midTeardownSpy).toHaveBeenCalledTimes(1)
    expect(readRunState(resolveRunDir(tempDir, 'r-mid-abort')).status).toBe('failed')
  })

  it('triggers config.teardown on mid-step options.signal abort and detaches signal listeners on completion', async () => {
    const midStepCtrl = new AbortController()
    const teardownSpy = vi.fn(async () => {})
    const step2Spy = vi.fn()

    const midStepRes = await runHarness({
      name: 'mid-step-abort-life',
      teardown: teardownSpy,
      steps: [
        {
          id: 's1',
          run: () => {
            midStepCtrl.abort(new Error('mid-step-cancelled'))
            return 'partial'
          },
        },
        { id: 's2', run: step2Spy },
      ],
    }, { runId: 'r-mid-step-abort', workspaceDir: tempDir, signal: midStepCtrl.signal })

    expect(midStepRes.status).toBe('failed')
    expect((midStepRes.error as Error).message).toBe('mid-step-cancelled')
    expect(step2Spy).not.toHaveBeenCalled()
    expect(teardownSpy).toHaveBeenCalledTimes(1)
    const midStepRunDir = resolveRunDir(tempDir, 'r-mid-step-abort')
    expect(readRunState(midStepRunDir).status).toBe('failed')
    expect(readLedgerEvents(midStepRunDir).some(e => e.eventType === 'run.passed')).toBe(false)

    const reusableCtrl = new AbortController()
    const removeSpy = vi.spyOn(reusableCtrl.signal, 'removeEventListener')
    const passRes = await runHarness({
      name: 'detach-signal-after-pass',
      steps: [
        {
          id: 's1',
          run: () => 'done',
        },
      ],
    }, { runId: 'r-detach-sig', workspaceDir: tempDir, signal: reusableCtrl.signal })

    expect(passRes.status).toBe('passed')
    expect(removeSpy).toHaveBeenCalledTimes(1)
    reusableCtrl.abort(new Error('late abort after completion'))
  })
})
