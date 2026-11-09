import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { defineHarness, resolveRunDir, runHarness } from '../src/index.js'
import { verifyEpic6Assertions } from './epic-06-assertions.js'
import { waitForGateAndResolve, waitForGateCondition } from './epic-06-client.js'
import {
  buildImplementStep,
  buildSpecStep,
  buildTriageStep,
  createInitialEpic6State,
} from './epic-06-steps.js'

let tempDir: string

beforeEach(() => {
  tempDir = mkdtempSync(path.join(os.tmpdir(), 'ludd-e2e-epic6-'))
})

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

async function driveStep1Interactions(runDir: string): Promise<void> {
  await waitForGateAndResolve(runDir, {
    stepId: 'triage-and-grilling',
    phase: 'beforeStep',
    action: 'pass',
    feedback: 'Build user auth with JWT tokens',
  })

  await waitForGateAndResolve(runDir, {
    stepId: 'triage-and-grilling',
    phase: 'afterStep',
    action: 'fail',
    feedback: 'Use jose library and 15m expiration',
  })

  await waitForGateAndResolve(runDir, {
    stepId: 'triage-and-grilling',
    phase: 'afterStep',
    action: 'pass',
  })
}

async function driveStep2AndCrash(runDir: string, abortController: AbortController): Promise<void> {
  await waitForGateCondition(runDir, gate =>
    gate.stepId === 'generate-spec-and-todos' && gate.phase === 'afterStep')
  abortController.abort('Simulated process SIGINT while waiting at afterStep gate')
}

async function driveStep2ResumeAndStep3(runDir: string): Promise<void> {
  await waitForGateAndResolve(runDir, {
    stepId: 'generate-spec-and-todos',
    phase: 'afterStep',
    action: 'pass',
  })

  await waitForGateAndResolve(runDir, {
    stepId: 'implement-slices',
    phase: 'afterStep',
    gateType: 'max_retries_exceeded',
    action: 'retry',
    addRetries: 1,
    feedback: 'Fix assertion: set token expiry to 15m',
  })
}

describe('epic 6 interactive human gates & crash rehydration E2E (AC 6.7.1 - AC 6.7.4)', () => {
  it('executes triage grilling, recovers from mid-gate crash, and escalates via IPC', async () => {
    const testState = createInitialEpic6State()
    const runId = 'e2e-epic-06-feature-run'
    const runDir = resolveRunDir(tempDir, runId)

    const harness = defineHarness({
      name: 'interactive-feature-workflow',
      steps: [
        buildTriageStep(testState),
        buildSpecStep(testState),
        buildImplementStep(tempDir, testState),
      ],
    })

    const run1Abort = new AbortController()
    const run1Promise = runHarness(harness, {
      runId,
      workspaceDir: tempDir,
      signal: run1Abort.signal,
    })

    await driveStep1Interactions(runDir)
    await driveStep2AndCrash(runDir, run1Abort)
    const run1Result = await run1Promise
    expect(run1Result.status).toBe('failed')

    const run2Promise = runHarness(harness, {
      runId,
      workspaceDir: tempDir,
    })

    await driveStep2ResumeAndStep3(runDir)
    const finalResult = await run2Promise

    verifyEpic6Assertions(finalResult, runDir, testState)
  })
})
