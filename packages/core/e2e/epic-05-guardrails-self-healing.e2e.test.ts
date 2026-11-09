import type { CapturedMcpData } from './epic-05-helpers.js'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  defineHarness,
  resolveRunDir,
  runHarness,
} from '../src/index.js'
import {
  buildImplementStep,
  buildReviewStep,

  setupSimulatedCommands,
  verifyEpic5Assertions,
} from './epic-05-helpers.js'

let tempDir: string

beforeEach(() => {
  tempDir = mkdtempSync(path.join(os.tmpdir(), 'ludd-e2e-epic5-'))
})

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

describe('epic 5 guardrails self-healing E2E pipeline (AC 5.5.2 & AC 5.5.3)', () => {
  it('executes self-healing turns, offloads & queries MCP logs, and runs commit exactly once', async () => {
    setupSimulatedCommands(tempDir)
    const captured: CapturedMcpData = {}
    const runId = 'e2e-epic-05-run'
    const runDir = resolveRunDir(tempDir, runId)

    const harness = defineHarness({
      name: 'epic-05-guardrails-self-healing-pipeline',
      steps: [
        buildImplementStep(tempDir, captured),
        buildReviewStep(tempDir),
      ],
    })

    const result = await runHarness(harness, {
      runId,
      workspaceDir: tempDir,
    })

    expect(result.status).toBe('passed')
    verifyEpic5Assertions(tempDir, runDir, captured)
  })
})
