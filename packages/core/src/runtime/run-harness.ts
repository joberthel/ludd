import type { StepContext, StepResult } from '../types/context.js'
import type { HarnessConfig, StepConfig } from '../types/harness.js'
import type { LedgerEventType } from '../types/ledger.js'
import type { RunStateSnapshot } from '../types/state.js'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { validateHarnessConfig } from '../define-harness.js'
import { appendLedgerEvent } from '../persistence/ledger-writer.js'
import { acquireRunPidLock, releaseRunPidLock } from '../persistence/pid-lock.js'
import { readRunState, resolveRunDir, writeRunStateAtomic } from '../persistence/state-store.js'
import { isAgentRunner } from '../types/harness.js'
import { executeAgentStep, validateStepOutput } from './agent-executor.js'

export interface RunHarnessOptions {
  runId?: string
  workspaceDir?: string
}

export interface HarnessRunResult {
  runId: string
  status: 'passed' | 'failed'
  steps: Record<string, StepResult<unknown>>
  failedStepId?: string
  error?: unknown
}

function resolveOption(value: string | undefined, fallback: () => string): string {
  const trimmed = value?.trim()
  if (trimmed !== undefined && trimmed !== '') {
    return trimmed
  }
  return fallback()
}

function createInitialContext(
  runId: string,
): StepContext<unknown, Record<string, StepResult<unknown>>> {
  return {
    runId,
    environments: {},
    steps: {},
    step: { id: '', output: undefined, attempt: 1 },
    matrix: undefined,
    artifacts: {},
  }
}

async function executeStep(
  step: StepConfig,
  ctx: StepContext<unknown, Record<string, StepResult<unknown>>>,
  runDir: string,
): Promise<unknown> {
  if (isAgentRunner(step.run)) {
    return executeAgentStep(step, step.run, ctx, runDir)
  }
  const rawOutput: unknown = await step.run(ctx)
  return validateStepOutput(step.id, step.outputSchema, rawOutput)
}

function persistSnapshot(runDir: string, snapshot: RunStateSnapshot): void {
  snapshot.updatedAt = new Date().toISOString()
  writeRunStateAtomic(runDir, snapshot)
}

function emitLedgerEvent(
  runDir: string,
  runId: string,
  stepId: string | null,
  eventType: LedgerEventType,
  payload: Record<string, unknown>,
): void {
  appendLedgerEvent(runDir, {
    schemaVersion: 1,
    timestamp: new Date().toISOString(),
    runId,
    stepId,
    eventType,
    payload,
  })
}

function initOrRehydrateSnapshot(
  runDir: string,
  runId: string,
  harnessName: string,
  steps: readonly StepConfig[],
  ctx: StepContext<unknown, Record<string, StepResult<unknown>>>,
): RunStateSnapshot {
  const isRehydrating = fs.existsSync(path.join(runDir, 'state.json'))
  let activeStepId: string | null = steps[0].id

  if (isRehydrating) {
    const previous = readRunState(runDir)
    for (const [id, result] of Object.entries(previous.steps)) {
      if (result.status === 'passed' || result.status === 'skipped') {
        ctx.steps[id] = result
      }
    }
    activeStepId = steps.find(
      s => ctx.steps[s.id]?.status !== 'passed' && ctx.steps[s.id]?.status !== 'skipped',
    )?.id ?? null
  }

  const snapshot: RunStateSnapshot = {
    schemaVersion: 1,
    runId,
    harnessName,
    status: 'running',
    activeStepId,
    steps: ctx.steps,
    updatedAt: new Date().toISOString(),
  }
  writeRunStateAtomic(runDir, snapshot)
  const eventType: LedgerEventType = isRehydrating
    ? 'run.resumed'
    : 'run.started'
  emitLedgerEvent(runDir, runId, null, eventType, { harnessName })
  return snapshot
}

function handleStepFailure(
  runDir: string,
  snapshot: RunStateSnapshot,
  stepId: string,
  error: unknown,
): HarnessRunResult {
  const errorMessage = error instanceof Error
    ? error.message
    : String(error)
  emitLedgerEvent(runDir, snapshot.runId, stepId, 'step.failed', { error: errorMessage })
  emitLedgerEvent(runDir, snapshot.runId, null, 'run.failed', {
    failedStepId: stepId,
    error: errorMessage,
  })
  snapshot.steps[stepId] = { status: 'failed', output: undefined }
  snapshot.status = 'failed'
  snapshot.activeStepId = null
  persistSnapshot(runDir, snapshot)
  return {
    runId: snapshot.runId,
    status: 'failed',
    steps: snapshot.steps,
    failedStepId: stepId,
    error,
  }
}

function recordStepResult(
  runDir: string,
  snapshot: RunStateSnapshot,
  stepId: string,
  ctx: StepContext<unknown, Record<string, StepResult<unknown>>>,
  status: 'passed' | 'skipped',
  output?: unknown,
): void {
  ctx.step = { id: stepId, output, attempt: ctx.step.attempt }
  ctx.steps[stepId] = { status, output }
  persistSnapshot(runDir, snapshot)
  const payload: Record<string, unknown> = {}
  if (status === 'passed') {
    payload.output = output
  }
  emitLedgerEvent(runDir, snapshot.runId, stepId, `step.${status}`, payload)
}

async function runStep(
  step: StepConfig,
  ctx: StepContext<unknown, Record<string, StepResult<unknown>>>,
  snapshot: RunStateSnapshot,
  runDir: string,
): Promise<HarnessRunResult | null> {
  const stepId = step.id
  ctx.step = { id: stepId, output: undefined, attempt: 1 }
  snapshot.activeStepId = stepId
  persistSnapshot(runDir, snapshot)

  try {
    if (step.if !== undefined && !(await step.if(ctx))) {
      recordStepResult(runDir, snapshot, stepId, ctx, 'skipped')
      return null
    }

    emitLedgerEvent(runDir, snapshot.runId, stepId, 'step.started', { attempt: 1 })
    const output = await executeStep(step, ctx, runDir)
    recordStepResult(runDir, snapshot, stepId, ctx, 'passed', output)
    return null
  }
  catch (error: unknown) {
    return handleStepFailure(runDir, snapshot, stepId, error)
  }
}

export async function runHarness(
  config: HarnessConfig,
  options?: RunHarnessOptions,
): Promise<HarnessRunResult> {
  const validatedConfig = validateHarnessConfig(config)
  const runId = resolveOption(options?.runId, randomUUID)
  const workspaceDir = resolveOption(options?.workspaceDir, () => process.cwd())
  const runDir = resolveRunDir(workspaceDir, runId)

  acquireRunPidLock(runDir, runId)

  try {
    const ctx = createInitialContext(runId)
    const steps = validatedConfig.steps as readonly StepConfig[]
    const snapshot = initOrRehydrateSnapshot(runDir, runId, validatedConfig.name, steps, ctx)

    for (const step of steps) {
      if (ctx.steps[step.id]?.status === 'passed' || ctx.steps[step.id]?.status === 'skipped') {
        continue
      }
      const failure = await runStep(step, ctx, snapshot, runDir)
      if (failure !== null) {
        return failure
      }
    }

    snapshot.status = 'passed'
    snapshot.activeStepId = null
    persistSnapshot(runDir, snapshot)
    emitLedgerEvent(runDir, runId, null, 'run.passed', {})

    return { runId, status: 'passed', steps: ctx.steps }
  }
  finally {
    releaseRunPidLock(runDir)
  }
}
