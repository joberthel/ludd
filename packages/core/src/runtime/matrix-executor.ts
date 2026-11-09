import type { EmbeddedMcpServer } from '../types/artifact.js'
import type { StepContext } from '../types/context.js'
import type { MatrixConfig, StepConfig } from '../types/harness.js'
import type { RunStateSnapshot } from '../types/state.js'
import type { RehydratedAgentState } from './agent-executor.js'
import { StepMatrixResolutionError } from '../errors/step-matrix-resolution-error.js'
import { writeRunStateAtomic } from '../persistence/state-store.js'
import { isAgentRunner } from '../types/harness.js'
import { resolveDynamicProperty } from '../utils/resolve-dynamic-property.js'
import { executeAgentStep, validateStepOutput } from './agent-executor.js'
import { validateStepArtifacts } from './artifact-validator.js'
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

export async function executeSingleSlice(
  step: StepConfig,
  ctx: StepContext,
  snapshot: RunStateSnapshot,
  runDir: string,
  rehydration?: RehydratedAgentState,
  mcpServer?: EmbeddedMcpServer,
): Promise<unknown> {
  if (isAgentRunner(step.run)) {
    return executeAgentStep(step, step.run, ctx, snapshot, runDir, rehydration, mcpServer)
  }
  const rawOutput: unknown = await step.run(ctx)
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
  })
  return validated
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

export async function executeMatrixStep(
  step: StepConfig,
  matrixConfig: MatrixConfig | undefined,
  ctx: StepContext,
  snapshot: RunStateSnapshot,
  runDir: string,
  rehydration?: RehydratedAgentState,
  mcpServer?: EmbeddedMcpServer,
): Promise<unknown[]> {
  const config = matrixConfig ?? step.matrix
  if (config === undefined) {
    throw new StepMatrixResolutionError(step.id, 'Matrix configuration is required.')
  }
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
    )
    outputs.push(sliceOutput)

    persistSliceState(runDir, snapshot, outputs, index + 1 < total
      ? index + 1
      : null)
  }
  ctx.matrix = undefined
  return outputs
}
