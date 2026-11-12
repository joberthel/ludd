import type { EmbeddedMcpServer } from '../types/artifact.js'
import type { StepContext, StepResult } from '../types/context.js'
import type { ProvisionedEnvironment } from '../types/environment.js'
import type { HarnessRunResult, StepConfig } from '../types/harness.js'
import type { LogStore } from '../types/log.js'
import type { RunStateSnapshot } from '../types/state.js'
import type { RehydratedAgentState } from './agent-executor.js'
import type { GateWaiter } from './gate-waiter.js'
import type { RehydrationInfo } from './harness-rehydration.js'
import { UnsafeDangerModeError } from '../errors/unsafe-danger-mode-error.js'
import { resolveStepEnvironment } from './environment-manager.js'
import { executeMatrixStep, executeSingleSlice } from './matrix-executor.js'
import {
  emitLedgerEvent,
  handleStepFailure,
  persistSnapshot,
  recordStepResult,
} from './run-harness-lifecycle.js'

async function executeStep(
  step: StepConfig,
  ctx: StepContext<unknown, Record<string, StepResult<unknown>>>,
  snapshot: RunStateSnapshot,
  runDir: string,
  rehydration?: RehydratedAgentState,
  mcpServer?: EmbeddedMcpServer,
  environment?: ProvisionedEnvironment,
  logStore?: LogStore,
  gateWaiter?: GateWaiter,
): Promise<unknown> {
  return step.matrix !== undefined
    ? executeMatrixStep(step, step.matrix, ctx, snapshot, runDir, rehydration, mcpServer, environment, logStore, gateWaiter)
    : executeSingleSlice(step, ctx, snapshot, runDir, rehydration, mcpServer, environment, logStore, gateWaiter)
}

async function runStep(
  step: StepConfig,
  ctx: StepContext<unknown, Record<string, StepResult<unknown>>>,
  snapshot: RunStateSnapshot,
  runDir: string,
  workspaceDir: string,
  rehydration?: RehydrationInfo,
  mcpServer?: EmbeddedMcpServer,
  logStore?: LogStore,
  gateWaiter?: GateWaiter,
  signal?: AbortSignal,
): Promise<HarnessRunResult | null> {
  const stepId = step.id
  const attempt = rehydration?.attempt ?? 1
  ctx.step = { id: stepId, output: rehydration?.activeStepOutput, attempt }
  snapshot.activeStepId = stepId
  persistSnapshot(runDir, snapshot)

  try {
    if (step.if !== undefined && !(await step.if(ctx))) {
      recordStepResult(runDir, snapshot, stepId, ctx, 'skipped')
      return null
    }
    const environment = await resolveStepEnvironment(step, ctx, workspaceDir, snapshot, runDir, signal)
    if (step.dangerMode === true && !environment.supportsDangerMode)
      throw new UnsafeDangerModeError(step.id, environment.type)
    emitLedgerEvent(runDir, snapshot.runId, stepId, 'step.started', { attempt })
    const output = await executeStep(step, ctx, snapshot, runDir, rehydration, mcpServer, environment, logStore, gateWaiter)
    recordStepResult(runDir, snapshot, stepId, ctx, 'passed', output)
    return null
  }
  catch (error: unknown) {
    return handleStepFailure(runDir, snapshot, stepId, error, ctx.matrix?.index)
  }
  finally {
    ctx.matrix = undefined
  }
}

export async function executeStepPipeline(
  steps: readonly StepConfig[],
  ctx: StepContext<unknown, Record<string, StepResult<unknown>>>,
  snapshot: RunStateSnapshot,
  runDir: string,
  workspaceDir: string,
  rehydration?: RehydrationInfo,
  mcpServer?: EmbeddedMcpServer,
  logStore?: LogStore,
  gateWaiter?: GateWaiter,
  signal?: AbortSignal,
): Promise<HarnessRunResult | null> {
  for (const step of steps) {
    if (signal?.aborted)
      return null
    if (ctx.steps[step.id]?.status === 'passed' || ctx.steps[step.id]?.status === 'skipped')
      continue
    const stepRehydration = rehydration?.stepId === step.id
      ? rehydration
      : undefined
    const failure = await runStep(step, ctx, snapshot, runDir, workspaceDir, stepRehydration, mcpServer, logStore, gateWaiter, signal)
    if (failure !== null)
      return failure
  }
  return null
}
