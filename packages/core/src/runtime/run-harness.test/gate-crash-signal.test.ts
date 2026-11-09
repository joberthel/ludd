import type { HarnessConfig } from '../../types/harness.js'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { humanReviewGuardrail } from '@ludd/guardrails'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createControlClient } from '../../ipc/control-client.js'
import { resolveRunDir } from '../../persistence/state-store.js'
import { runHarness } from '../run-harness.js'

let tempDir: string

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-gate-signal-'))
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

const testConfig: HarnessConfig = {
  name: 'signal-abort-pipeline',
  steps: [
    {
      id: 'step-gate',
      beforeStep: [
        humanReviewGuardrail({ prompt: 'Waiting at gate' }),
      ],
      run: async () => 'ok',
    },
  ],
}

describe('runHarness options.signal support', () => {
  it('aborts immediately if options.signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort('Pre-aborted')

    const result = await runHarness(testConfig, {
      runId: 'pre-aborted-run',
      workspaceDir: tempDir,
      signal: controller.signal,
    })

    expect(result.status).toBe('failed')
  })

  it('aborts running harness when options.signal aborts while waiting at gate', async () => {
    const controller = new AbortController()
    const runId = 'live-aborted-run'
    const runDir = resolveRunDir(tempDir, runId)

    const runPromise = runHarness(testConfig, {
      runId,
      workspaceDir: tempDir,
      signal: controller.signal,
    })

    for (let i = 0; i < 50; i++) {
      try {
        const client = await createControlClient(runDir)
        const state = await client.status()
        await client.close()
        if (state.status === 'waiting_for_gate') {
          break
        }
      }
      catch {
        // Socket waiting
      }
      await new Promise(r => setTimeout(r, 50))
    }

    controller.abort('SIGINT simulated')
    const result = await runPromise

    expect(result.status).toBe('failed')
  })
})
