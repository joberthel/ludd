import type { EmbeddedMcpServer } from '../types/artifact.js'
import type { StepContext } from '../types/context.js'
import type { ProvisionedEnvironment } from '../types/environment.js'
import type { MatrixConfig, StepConfig } from '../types/harness.js'
import type { LogStore } from '../types/log.js'
import type { RunStateSnapshot } from '../types/state.js'
import type { RehydratedAgentState } from './agent-executor.js'
import type { GateWaiter } from './gate-waiter.js'
import { writeRunStateAtomic } from '../persistence/state-store.js'
import { runBeforeStepGuardrails } from './before-step-executor.js'
import { assertMatrixConfig, persistSliceState, resolveMatrixItems } from './matrix-resolver.js'
import { executeStepRun } from './step-run-executor.js'

export { resolveMatrixItems }

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
  if (rehydration?.activeGate?.phase === 'afterStep') {
    return ''
  }
  const isInitial = !rehydration || (rehydration.attempt ?? 1) <= 1
  if (!isInitial || !step.beforeStep) {
    return ''
  }
  const startIndex = rehydration?.activeGate?.phase === 'beforeStep'
    ? rehydration.activeGate.guardrailIndex
    : 0
  return runBeforeStepGuardrails({
    step,
    ctx,
    snapshot,
    runDir,
    mcpServer,
    environment,
    logStore,
    gateWaiter,
    startIndex,
  })
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

  return executeStepRun(step, {
    ctx,
    snapshot,
    runDir,
    rehydration,
    mcpServer,
    environment,
    logStore,
    gateWaiter,
  }, beforeStepNotification)
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
