import type { StepContext, StepResult } from '../types/context.js'
import type { HarnessConfig, StepConfig } from '../types/harness.js'
import type { RunStateSnapshot } from '../types/state.js'
import { randomUUID } from 'node:crypto'
import process from 'node:process'
import { validateHarnessConfig } from '../define-harness.js'
import { StepOutputValidationError } from '../errors/step-output-validation-error.js'
import { resolveRunDir, writeRunStateAtomic } from '../persistence/state-store.js'
import { isAgentRunner } from '../types/harness.js'

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

function resolveRunId(options?: RunHarnessOptions): string {
  const candidate = options?.runId
  if (candidate !== undefined) {
    const trimmed = candidate.trim()
    if (trimmed !== '') {
      return trimmed
    }
  }
  return randomUUID()
}

function resolveWorkspaceDir(options?: RunHarnessOptions): string {
  const candidate = options?.workspaceDir
  if (candidate !== undefined) {
    const trimmed = candidate.trim()
    if (trimmed !== '') {
      return trimmed
    }
  }
  return process.cwd()
}

function createInitialContext(
  runId: string,
): StepContext<unknown, Record<string, StepResult<unknown>>> {
  return {
    runId,
    environments: {},
    steps: {},
    step: {
      id: '',
      output: undefined,
      attempt: 1,
    },
    matrix: undefined,
    artifacts: {},
  }
}

async function validateStepOutput(
  stepId: string,
  schema: StepConfig['outputSchema'],
  rawOutput: unknown,
): Promise<unknown> {
  if (schema === undefined) {
    return rawOutput
  }
  const parsed = await schema.safeParseAsync(rawOutput)
  if (!parsed.success) {
    throw new StepOutputValidationError(stepId, rawOutput, parsed.error.issues)
  }
  return parsed.data
}

async function executeStep(
  step: StepConfig,
  ctx: StepContext<unknown, Record<string, StepResult<unknown>>>,
): Promise<unknown> {
  const rawOutput: unknown = isAgentRunner(step.run)
    ? await step.run.execute(ctx)
    : await step.run(ctx)
  return validateStepOutput(step.id, step.outputSchema, rawOutput)
}

function persistSnapshot(runDir: string, snapshot: RunStateSnapshot): void {
  snapshot.updatedAt = new Date().toISOString()
  writeRunStateAtomic(runDir, snapshot)
}

function initRunSnapshot(
  runDir: string,
  runId: string,
  harnessName: string,
  firstStepId: string,
  steps: Record<string, StepResult<unknown>>,
): RunStateSnapshot {
  const snapshot: RunStateSnapshot = {
    schemaVersion: 1,
    runId,
    harnessName,
    status: 'running',
    activeStepId: firstStepId,
    steps,
    updatedAt: new Date().toISOString(),
  }
  writeRunStateAtomic(runDir, snapshot)
  return snapshot
}

function handleStepFailure(
  runDir: string,
  snapshot: RunStateSnapshot,
  stepId: string,
  error: unknown,
): HarnessRunResult {
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

export async function runHarness(
  config: HarnessConfig,
  options?: RunHarnessOptions,
): Promise<HarnessRunResult> {
  const validatedConfig = validateHarnessConfig(config)
  const runId = resolveRunId(options)
  const workspaceDir = resolveWorkspaceDir(options)
  const runDir = resolveRunDir(workspaceDir, runId)
  const ctx = createInitialContext(runId)
  const steps = validatedConfig.steps as readonly StepConfig[]
  const snapshot = initRunSnapshot(runDir, runId, validatedConfig.name, steps[0].id, ctx.steps)

  for (const step of steps) {
    const stepId = step.id
    ctx.step = { id: stepId, output: undefined, attempt: 1 }
    snapshot.activeStepId = stepId
    persistSnapshot(runDir, snapshot)

    try {
      if (step.if !== undefined && !(await step.if(ctx))) {
        ctx.steps[stepId] = { status: 'skipped', output: undefined }
        persistSnapshot(runDir, snapshot)
        continue
      }

      const output = await executeStep(step, ctx)
      ctx.step = { id: stepId, output, attempt: 1 }
      ctx.steps[stepId] = { status: 'passed', output }
      persistSnapshot(runDir, snapshot)
    }
    catch (error: unknown) {
      return handleStepFailure(runDir, snapshot, stepId, error)
    }
  }

  snapshot.status = 'passed'
  snapshot.activeStepId = null
  persistSnapshot(runDir, snapshot)

  return { runId, status: 'passed', steps: ctx.steps }
}
