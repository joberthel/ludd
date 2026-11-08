import type { StepContext, StepResult } from '../types/context.js'
import type { HarnessConfig, StepConfig } from '../types/harness.js'
import { randomUUID } from 'node:crypto'
import { validateHarnessConfig } from '../define-harness.js'
import { StepOutputValidationError } from '../errors/step-output-validation-error.js'
import { isAgentRunner } from '../types/harness.js'

export interface RunHarnessOptions {
  runId?: string
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

export async function runHarness(
  config: HarnessConfig,
  options?: RunHarnessOptions,
): Promise<HarnessRunResult> {
  const validatedConfig = validateHarnessConfig(config)
  const runId = resolveRunId(options)
  const ctx = createInitialContext(runId)
  const steps = validatedConfig.steps as readonly StepConfig[]

  for (const step of steps) {
    const stepId = step.id
    ctx.step = { id: stepId, output: undefined, attempt: 1 }

    try {
      if (step.if !== undefined && !(await step.if(ctx))) {
        ctx.steps[stepId] = { status: 'skipped', output: undefined }
        continue
      }

      const rawOutput: unknown = isAgentRunner(step.run)
        ? await step.run.execute(ctx)
        : await step.run(ctx)

      const output = await validateStepOutput(stepId, step.outputSchema, rawOutput)

      ctx.step = { id: stepId, output, attempt: 1 }
      ctx.steps[stepId] = { status: 'passed', output }
    }
    catch (error: unknown) {
      ctx.steps[stepId] = { status: 'failed', output: undefined }
      return {
        runId,
        status: 'failed',
        steps: ctx.steps,
        failedStepId: stepId,
        error,
      }
    }
  }

  return {
    runId,
    status: 'passed',
    steps: ctx.steps,
  }
}
