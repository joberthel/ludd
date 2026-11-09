import type { EmbeddedMcpServer } from '../types/artifact.js'
import type { StepContext } from '../types/context.js'
import type { ProvisionedEnvironment } from '../types/environment.js'
import type { MatrixConfig, StepConfig } from '../types/harness.js'
import type { LogStore } from '../types/log.js'
import type { RunStateSnapshot } from '../types/state.js'
import type { RehydratedAgentState } from './agent-executor.js'
import type { GateWaiter } from './gate-waiter.js'
import { StepMatrixResolutionError } from '../errors/step-matrix-resolution-error.js'
import { writeRunStateAtomic } from '../persistence/state-store.js'
import { isAgentRunner } from '../types/harness.js'
import { resolveDynamicProperty } from '../utils/resolve-dynamic-property.js'
import { executeAgentStep, validateStepOutput } from './agent-executor.js'
import { validateStepArtifacts } from './artifact-validator.js'
import { runBeforeStepGuardrails } from './before-step-executor.js'
import { runAfterStepGuardrails } from './guardrail-executor.js'

export async function resolveMatrixItems(
  stepId: string,
  matrixConfig: MatrixConfig,
  ctx: StepContext,
): Promise<readonly unknown[]> {
  if ('itemsFromArtifact' in matrixConfig && matrixConfig.itemsFromArtifact !== undefined) {
    const artifactKey = matrixConfig.itemsFromArtifact
    const rawContent = await ctx.artifacts.get(artifactKey)
    if (rawContent === null) {
      throw new StepMatrixResolutionError(stepId, `Artifact "${artifactKey}" not found.`)
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(rawContent)
    }
    catch {
      throw new StepMatrixResolutionError(
        stepId,
        `Artifact "${artifactKey}" does not contain valid JSON.`,
      )
    }
    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new StepMatrixResolutionError(
        stepId,
        `Artifact "${artifactKey}" must contain a non-empty JSON array.`,
      )
    }
    return parsed as readonly unknown[]
  }

  const items = await resolveDynamicProperty(matrixConfig.items, ctx)
  if (!Array.isArray(items) || items.length === 0) {
    throw new StepMatrixResolutionError(
      stepId,
      'Matrix "items" must resolve to a non-empty array.',
    )
  }
  return items as readonly unknown[]
}

async function resolveBeforeStepContext(
  step: StepConfig,
  ctx: StepContext,
  snapshot: RunStateSnapshot,
  runDir: string,
  rehydration?: RehydratedAgentState,
  mcpServer?: EmbeddedMcpServer,
  environment?: ProvisionedEnvironment,
  logStore?: LogStore,
  gateWaiter?: GateWaiter,
): Promise<string> {
  const isInitial = !rehydration || (rehydration.attempt ?? 1) <= 1
  if (!isInitial || !step.beforeStep || step.beforeStep.length === 0) {
    return ''
  }
  return runBeforeStepGuardrails({
    step,
    ctx,
    snapshot,
    runDir,
    mcpServer,
    environment,
    logStore,
    gateWaiter,
  })
}

async function executeFunctionStep(
  step: StepConfig,
  runner: (ctx: StepContext) => Promise<unknown> | unknown,
  ctx: StepContext,
  snapshot: RunStateSnapshot,
  runDir: string,
  mcpServer?: EmbeddedMcpServer,
  environment?: ProvisionedEnvironment,
  logStore?: LogStore,
): Promise<unknown> {
  const rawOutput: unknown = await runner(ctx)
  const validated = await validateStepOutput(step.id, step.outputSchema, rawOutput)
  await validateStepArtifacts(step.id, step.artifacts, ctx.artifacts)
  ctx.step = { id: step.id, output: validated, attempt: ctx.step.attempt }
  await runAfterStepGuardrails({
    step,
    ctx,
    snapshot,
    runDir,
    attempt: ctx.step.attempt,
    sessionId: undefined,
    maxTotalTurns: 1,
    initialPrompt: '',
    mcpServer,
    environment,
    logStore,
  })
  return validated
}

export async function executeSingleSlice(
  step: StepConfig,
  ctx: StepContext,
  snapshot: RunStateSnapshot,
  runDir: string,
  rehydration?: RehydratedAgentState,
  mcpServer?: EmbeddedMcpServer,
  environment?: ProvisionedEnvironment,
  logStore?: LogStore,
  gateWaiter?: GateWaiter,
): Promise<unknown> {
  const beforeStepNotification = await resolveBeforeStepContext(
    step,
    ctx,
    snapshot,
    runDir,
    rehydration,
    mcpServer,
    environment,
    logStore,
    gateWaiter,
  )

  if (isAgentRunner(step.run)) {
    return executeAgentStep(
      step,
      step.run,
      ctx,
      snapshot,
      runDir,
      rehydration,
      mcpServer,
      environment,
      logStore,
      beforeStepNotification,
    )
  }
  return executeFunctionStep(
    step,
    step.run,
    ctx,
    snapshot,
    runDir,
    mcpServer,
    environment,
    logStore,
  )
}

function persistSliceState(
  runDir: string,
  snapshot: RunStateSnapshot,
  outputs: unknown[],
  index: number | null,
): void {
  snapshot.activeMatrixOutputs = [...outputs]
  snapshot.activeMatrixIndex = index
  snapshot.activeSessionId = null
  snapshot.activeStepAttempt = 1
  snapshot.activeGuardrailRetries = undefined
  snapshot.updatedAt = new Date().toISOString()
  writeRunStateAtomic(runDir, snapshot)
}

function assertMatrixConfig(config: MatrixConfig | undefined, stepId: string): MatrixConfig {
  if (config === undefined) {
    throw new StepMatrixResolutionError(stepId, 'Matrix configuration is required.')
  }
  return config
}

export async function executeMatrixStep(
  step: StepConfig,
  matrixConfig: MatrixConfig | undefined,
  ctx: StepContext,
  snapshot: RunStateSnapshot,
  runDir: string,
  rehydration?: RehydratedAgentState,
  mcpServer?: EmbeddedMcpServer,
  environment?: ProvisionedEnvironment,
  logStore?: LogStore,
  gateWaiter?: GateWaiter,
): Promise<unknown[]> {
  const config = assertMatrixConfig(matrixConfig ?? step.matrix, step.id)
  const items = await resolveMatrixItems(step.id, config, ctx)
  const total = items.length
  const outputs: unknown[] = rehydration?.matrixOutputs
    ? [...rehydration.matrixOutputs]
    : []
  const startIndex = rehydration?.matrixIndex ?? 0

  for (let index = startIndex; index < total; index++) {
    snapshot.activeMatrixIndex = index
    snapshot.activeMatrixOutputs = [...outputs]
    snapshot.updatedAt = new Date().toISOString()
    writeRunStateAtomic(runDir, snapshot)

    ctx.matrix = { index, total, item: items[index] }
    ctx.step = { id: step.id, output: undefined, attempt: 1 }

    const sliceRehydration = index === startIndex
      ? rehydration
      : undefined
    const sliceOutput = await executeSingleSlice(
      step,
      ctx,
      snapshot,
      runDir,
      sliceRehydration,
      mcpServer,
      environment,
      logStore,
      gateWaiter,
    )
    outputs.push(sliceOutput)

    persistSliceState(runDir, snapshot, outputs, index + 1 < total
      ? index + 1
      : null)
  }
  ctx.matrix = undefined
  return outputs
}
