import type { EmbeddedMcpServer } from '../types/artifact.js'
import type { StepContext } from '../types/context.js'
import type { StepConfig } from '../types/harness.js'
import type { LogStore } from '../types/log.js'
import type { RunStateSnapshot } from '../types/state.js'
import type { RehydratedAgentState } from './agent-executor.js'
import type { GateWaiter } from './gate-waiter.js'
import { isAgentRunner } from '../types/harness.js'
import { executeAgentStep, validateStepOutput } from './agent-executor.js'
import { validateStepArtifacts } from './artifact-validator.js'
import { runAfterStepGuardrails } from './guardrail-executor.js'
import { GuardrailRetrySignal } from './guardrail-retry-signal.js'

interface StepRunExecutionParams {
  ctx: StepContext
  snapshot: RunStateSnapshot
  runDir: string
  rehydration?: RehydratedAgentState
  mcpServer?: EmbeddedMcpServer
  cwd?: string
  env?: Record<string, string>
  signal?: AbortSignal
  logStore?: LogStore
  gateWaiter?: GateWaiter
}

async function resumeFunctionAfterStepGate(
  step: StepConfig,
  params: StepRunExecutionParams,
): Promise<unknown> {
  const { ctx, snapshot, runDir, rehydration, mcpServer, cwd, env, signal, logStore, gateWaiter } = params
  const activeGate = rehydration!.activeGate!
  ctx.step = { id: step.id, output: rehydration!.activeStepOutput, attempt: ctx.step.attempt }
  await runAfterStepGuardrails({
    step,
    ctx,
    snapshot,
    runDir,
    attempt: ctx.step.attempt,
    sessionId: undefined,
    initialPrompt: '',
    isAgent: false,
    mcpServer,
    cwd,
    env,
    signal,
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
  const { ctx, snapshot, runDir, rehydration, mcpServer, cwd, env, signal, logStore, gateWaiter } = params
  let shouldResumeGate = rehydration?.activeGate?.phase === 'afterStep'

  while (true) {
    try {
      if (shouldResumeGate) {
        shouldResumeGate = false
        return await resumeFunctionAfterStepGate(step, params)
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
        initialPrompt: '',
        isAgent: false,
        mcpServer,
        cwd,
        env,
        signal,
        logStore,
        gateWaiter,
      })
      return validated
    }
    catch (err) {
      if (err instanceof GuardrailRetrySignal) {
        ctx.step.attempt += 1
        continue
      }
      throw err
    }
  }
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
  const { ctx, snapshot, runDir, rehydration, mcpServer, cwd, env, signal, logStore, gateWaiter } = params
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
      { cwd, env, signal },
      logStore,
      beforeStepNotification,
      gateWaiter,
    )
  }
  const stepRun = step.run as (ctx: StepContext) => Promise<unknown> | unknown
  let firstAttempt = true
  return executeFunctionStep(step, async (context) => {
    if (firstAttempt) {
      firstAttempt = false
      return run
    }
    return stepRun(context)
  }, params)
}
