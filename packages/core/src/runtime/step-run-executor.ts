import type { EmbeddedMcpServer } from '../types/artifact.js'
import type { StepContext } from '../types/context.js'
import type { ProvisionedEnvironment } from '../types/environment.js'
import type { StepConfig } from '../types/harness.js'
import type { LogStore } from '../types/log.js'
import type { RunStateSnapshot } from '../types/state.js'
import type { RehydratedAgentState } from './agent-executor.js'
import type { GateWaiter } from './gate-waiter.js'
import { isAgentRunner } from '../types/harness.js'
import { executeAgentStep, validateStepOutput } from './agent-executor.js'
import { validateStepArtifacts } from './artifact-validator.js'
import { runAfterStepGuardrails } from './guardrail-executor.js'

interface StepRunExecutionParams {
  ctx: StepContext
  snapshot: RunStateSnapshot
  runDir: string
  rehydration?: RehydratedAgentState
  mcpServer?: EmbeddedMcpServer
  environment?: ProvisionedEnvironment
  logStore?: LogStore
  gateWaiter?: GateWaiter
}

async function resumeFunctionAfterStepGate(
  step: StepConfig,
  params: StepRunExecutionParams,
): Promise<unknown> {
  const { ctx, snapshot, runDir, rehydration, mcpServer, environment, logStore, gateWaiter } = params
  const activeGate = rehydration!.activeGate!
  ctx.step = { id: step.id, output: rehydration!.activeStepOutput, attempt: ctx.step.attempt }
  await runAfterStepGuardrails({
    step,
    ctx,
    snapshot,
    runDir,
    attempt: ctx.step.attempt,
    sessionId: undefined,
    maxTotalTurns: 1,
    initialPrompt: '',
    isAgent: false,
    mcpServer,
    environment,
    logStore,
    gateWaiter,
    startGuardrailIndex: activeGate.guardrailIndex,
    rehydratedGate: activeGate,
  })
  return rehydration!.activeStepOutput
}

async function executeFunctionStep(
  step: StepConfig,
  runner: (ctx: StepContext) => Promise<unknown> | unknown,
  params: StepRunExecutionParams,
): Promise<unknown> {
  const { ctx, snapshot, runDir, rehydration, mcpServer, environment, logStore, gateWaiter } = params
  if (rehydration?.activeGate?.phase === 'afterStep') {
    return resumeFunctionAfterStepGate(step, params)
  }
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
    isAgent: false,
    mcpServer,
    environment,
    logStore,
    gateWaiter,
  })
  return validated
}

function hasAgentSessionOutput(output: unknown): boolean {
  return typeof output === 'object'
    && output !== null
    && 'sessionId' in output
    && typeof output.sessionId === 'string'
}

export async function executeStepRun(
  step: StepConfig,
  params: StepRunExecutionParams,
  beforeStepNotification: string,
): Promise<unknown> {
  const { ctx, snapshot, runDir, rehydration, mcpServer, environment, logStore, gateWaiter } = params
  const isFunctionGateResume = rehydration?.activeGate?.phase === 'afterStep'
    && !hasAgentSessionOutput(rehydration.activeStepOutput)
  if (typeof step.run === 'function' && isFunctionGateResume) {
    return executeFunctionStep(step, step.run, params)
  }
  const run = typeof step.run === 'function'
    ? await step.run(ctx)
    : step.run
  if (isAgentRunner(run)) {
    return executeAgentStep(
      step,
      run,
      ctx,
      snapshot,
      runDir,
      rehydration,
      mcpServer,
      environment,
      logStore,
      beforeStepNotification,
      gateWaiter,
    )
  }
  return executeFunctionStep(step, async () => run, params)
}
