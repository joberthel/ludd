import type { StepContext } from '../types/context.js'
import type { MatrixConfig } from '../types/harness.js'
import type { RunStateSnapshot } from '../types/state.js'
import { StepMatrixResolutionError } from '../errors/step-matrix-resolution-error.js'
import { writeRunStateAtomic } from '../persistence/state-store.js'
import { resolveDynamicProperty } from '../utils/resolve-dynamic-property.js'

export function persistSliceState(
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
  snapshot.activeGate = null
  snapshot.activeStepOutput = undefined
  snapshot.updatedAt = new Date().toISOString()
  writeRunStateAtomic(runDir, snapshot)
}

export function assertMatrixConfig(config: MatrixConfig | undefined, stepId: string): MatrixConfig {
  if (config === undefined) {
    throw new StepMatrixResolutionError(stepId, 'Matrix configuration is required.')
  }
  return config
}

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
