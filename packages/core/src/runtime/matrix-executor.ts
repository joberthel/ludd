import type { EmbeddedMcpServer } from '../types/artifact.js'
import type { StepContext } from '../types/context.js'
import type { MatrixConfig, StepConfig } from '../types/harness.js'
import type { LogStore } from '../types/log.js'
import type { RunStateSnapshot } from '../types/state.js'
import type { RehydratedAgentState } from './agent-executor.js'
import type { ResolvedExecutionContext } from './execution-context.js'
import type { GateWaiter } from './gate-waiter.js'
import process from 'node:process'
import { writeRunStateAtomic } from '../persistence/state-store.js'
import { runBeforeStepGuardrails } from './before-step-executor.js'
import { resolveStepExecutionContext } from './execution-context.js'
import { runInitialInteractiveQuestions } from './interactive-executor.js'
import { assertMatrixConfig, persistSliceState, resolveMatrixItems } from './matrix-resolver.js'
import { executeStepRun } from './step-run-executor.js'

export { resolveMatrixItems }

export interface StepSliceExecutionOptions {
  cwd?: string
  env?: Record<string, string>
  signal?: AbortSignal
}

async function resolveBeforeStepContext(
  step: StepConfig,
  ctx: StepContext,
  snapshot: RunStateSnapshot,
  runDir: string,
  rehydration?: RehydratedAgentState,
  mcpServer?: EmbeddedMcpServer,
  executionContext?: StepSliceExecutionOptions,
  logStore?: LogStore,
  gateWaiter?: GateWaiter,
): Promise<string> {
  if (rehydration?.activeGate?.phase === 'afterStep') {
    if (snapshot.activeBeforeStepResults !== undefined) {
      ;(ctx as StepContext & { beforeStep: unknown }).beforeStep = snapshot.activeBeforeStepResults
    }
    return ''
  }
  if (!rehydration) {
    ;(ctx as StepContext & { beforeStep: unknown }).beforeStep = {}
    snapshot.activeBeforeStepResults = undefined
  }
  else if (rehydration.activeGate?.phase !== 'beforeStep' && snapshot.activeBeforeStepResults !== undefined) {
    ;(ctx as StepContext & { beforeStep: unknown }).beforeStep = snapshot.activeBeforeStepResults
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
    cwd: executionContext?.cwd,
    env: executionContext?.env,
    signal: executionContext?.signal,
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
  executionContext?: StepSliceExecutionOptions,
  logStore?: LogStore,
  gateWaiter?: GateWaiter,
): Promise<unknown> {
  const baseExecutionContext: ResolvedExecutionContext = {
    cwd: executionContext?.cwd ?? process.cwd(),
    env: executionContext?.env ?? {},
  }
  const resolvedExecution = await resolveStepExecutionContext({
    step,
    stepCtx: ctx,
    runExecutionContext: baseExecutionContext,
  })
  const signal = executionContext?.signal ?? gateWaiter?.signal
  const sliceExecution: StepSliceExecutionOptions = {
    cwd: resolvedExecution.cwd,
    env: resolvedExecution.env,
    signal,
  }

  const beforeStepNotification = await resolveBeforeStepContext(
    step,
    ctx,
    snapshot,
    runDir,
    rehydration,
    mcpServer,
    sliceExecution,
    logStore,
    gateWaiter,
  )

  await runInitialInteractiveQuestions({
    step,
    ctx,
    snapshot,
    runDir,
    gateWaiter,
  })

  return executeStepRun(step, {
    ctx,
    snapshot,
    runDir,
    rehydration,
    mcpServer,
    cwd: resolvedExecution.cwd,
    env: resolvedExecution.env,
    signal,
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
  executionContext?: StepSliceExecutionOptions,
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
    snapshot.activeMatrixTotal = total
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
      executionContext,
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
