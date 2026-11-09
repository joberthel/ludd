import type { AgentRunner } from '../types/agent.js'
import type { EmbeddedMcpServer } from '../types/artifact.js'
import type { StepContext } from '../types/context.js'
import type { ProvisionedEnvironment } from '../types/environment.js'
import type { StepConfig } from '../types/harness.js'
import type { LogStore } from '../types/log.js'
import type { ActiveGateState, RunStateSnapshot } from '../types/state.js'
import type { RehydratedAgentPromptState } from './agent-prompt.js'
import type { GateWaiter } from './gate-waiter.js'
import type { RunAfterStepGuardrailsParams } from './guardrail-executor.js'
import process from 'node:process'
import { DEFAULT_MAX_TOTAL_TURNS, MaxTotalTurnsExceededError } from '../errors/max-total-turns-exceeded-error.js'
import { StepArtifactValidationError } from '../errors/step-artifact-validation-error.js'
import { StepOutputValidationError } from '../errors/step-output-validation-error.js'
import { writeRunStateAtomic } from '../persistence/state-store.js'
import { resolveDynamicProperty } from '../utils/resolve-dynamic-property.js'
import { formatRetryPrompt, resolveInitialPrompt } from './agent-prompt.js'
import {
  createAgentStepOutput,
  resolveSessionId,
  validateStepOutput,
} from './agent-step-output.js'
import { emitPreTurnEvents, emitTurnCompleted } from './agent-telemetry.js'
import { formatArtifactRetryPrompt, validateStepArtifacts } from './artifact-validator.js'
import { createDefaultHostEnvironment } from './environment-manager.js'
import {
  emitStepRetry,
  GuardrailRetrySignal,
  runAfterStepGuardrails,
} from './guardrail-executor.js'

export type RehydratedAgentState = RehydratedAgentPromptState
export { createAgentStepOutput, formatRetryPrompt, resolveInitialPrompt, validateStepOutput }

interface TurnRetryParams {
  stepId: string
  maxTotalTurns: number
  attempt: number
  runDir: string
  ctx: StepContext
  sessionId: string
  initialPrompt: string
}

function handleTurnRetry(err: unknown, params: TurnRetryParams): string {
  if (err instanceof GuardrailRetrySignal) {
    return err.prompt
  }
  if (
    !(err instanceof StepOutputValidationError)
    && !(err instanceof StepArtifactValidationError)
  ) {
    throw err
  }
  if (params.attempt >= params.maxTotalTurns) {
    throw new MaxTotalTurnsExceededError(params.stepId, params.maxTotalTurns, err)
  }

  const nextAttempt = params.attempt + 1
  params.ctx.step.attempt = nextAttempt

  const isArtifact = err instanceof StepArtifactValidationError
  const reason = isArtifact ? 'artifact_validation_failed' : 'output_schema_validation_failed'
  emitStepRetry(params.runDir, params.ctx, params.stepId, params.sessionId, nextAttempt, reason, err.issues)
  return isArtifact
    ? formatArtifactRetryPrompt(params.initialPrompt, err.issues)
    : formatRetryPrompt(params.initialPrompt, err.issues)
}

function persistActiveTurn(runDir: string, snapshot: RunStateSnapshot, sessionId: string, attempt: number): void {
  snapshot.activeSessionId = sessionId
  snapshot.activeStepAttempt = attempt
  snapshot.activeStepOutput = undefined
  snapshot.updatedAt = new Date().toISOString()
  writeRunStateAtomic(runDir, snapshot)
}

async function finalizeAgentTurn(
  step: StepConfig,
  turnResult: { output: unknown, sessionId: string },
  params: Omit<RunAfterStepGuardrailsParams, 'step' | 'sessionId'>,
): Promise<unknown> {
  const validated = await validateStepOutput(step.id, step.outputSchema, turnResult.output)
  await validateStepArtifacts(step.id, step.artifacts, params.ctx.artifacts)
  const stepOutput = createAgentStepOutput(validated, turnResult.sessionId)
  params.ctx.step = { id: step.id, output: stepOutput, attempt: params.attempt }
  await runAfterStepGuardrails({
    ...params,
    step,
    sessionId: turnResult.sessionId,
    environment: params.environment,
  })
  return stepOutput
}

interface AgentTurnExecutionScope {
  step: StepConfig
  agent: AgentRunner
  ctx: StepContext
  snapshot: RunStateSnapshot
  runDir: string
  sessionId: string
  initialPrompt: string
  maxTotalTurns: number
  environment: ProvisionedEnvironment
  mcpServer?: Pick<EmbeddedMcpServer, 'url' | 'authToken'>
  logStore?: LogStore
  gateWaiter?: GateWaiter
  activeGate?: ActiveGateState | null
  activeStepOutput?: unknown
}

async function resumeAfterStepGate(
  scope: AgentTurnExecutionScope,
  attempt: number,
  gate: ActiveGateState,
): Promise<{ success: true, result: unknown } | { success: false, nextPrompt: string }> {
  try {
    const output = typeof scope.activeStepOutput === 'object' && scope.activeStepOutput !== null
      && !('sessionId' in (scope.activeStepOutput as Record<string, unknown>))
      ? createAgentStepOutput(scope.activeStepOutput, scope.sessionId)
      : scope.activeStepOutput
    scope.ctx.step.output = output
    await runAfterStepGuardrails({
      ...scope,
      step: scope.step,
      sessionId: scope.sessionId,
      attempt,
      startGuardrailIndex: gate.guardrailIndex,
      rehydratedGate: gate,
    })
    return { success: true, result: output }
  }
  catch (err: unknown) {
    const nextPrompt = handleTurnRetry(err, { ...scope, stepId: scope.step.id, attempt })
    return { success: false, nextPrompt }
  }
}

async function runTurnLoopAttempt(
  scope: AgentTurnExecutionScope,
  currentPrompt: string,
  attempt: number,
): Promise<{ success: true, result: unknown } | { success: false, nextPrompt: string }> {
  scope.ctx.step.attempt = attempt
  if (scope.activeGate?.phase === 'afterStep') {
    const gate = scope.activeGate
    scope.activeGate = null
    return resumeAfterStepGate(scope, attempt, gate)
  }

  persistActiveTurn(scope.runDir, scope.snapshot, scope.sessionId, attempt)
  emitPreTurnEvents(scope.runDir, scope.ctx, scope.step.id, scope.sessionId, currentPrompt, scope.agent.mode, attempt)

  const turnResult = await scope.agent.executeTurn({
    ctx: scope.ctx,
    stepId: scope.step.id,
    prompt: currentPrompt,
    sessionId: scope.sessionId,
    attempt,
    mode: scope.agent.mode,
    dangerMode: Boolean(scope.step.dangerMode),
    runDir: scope.runDir,
    environment: scope.environment,
    mcpServerUrl: scope.mcpServer?.url ?? '',
    mcpAuthToken: scope.mcpServer?.authToken ?? '',
  })
  emitTurnCompleted(scope.runDir, scope.ctx, scope.step.id, scope.sessionId, turnResult.output, attempt)

  try {
    const result = await finalizeAgentTurn(scope.step, turnResult, {
      ...scope,
      attempt,
    })
    return { success: true, result }
  }
  catch (err: unknown) {
    const nextPrompt = handleTurnRetry(err, {
      ...scope,
      stepId: scope.step.id,
      attempt,
    })
    return { success: false, nextPrompt }
  }
}

export async function executeAgentStep(
  step: StepConfig,
  agent: AgentRunner,
  ctx: StepContext,
  snapshot: RunStateSnapshot,
  runDir: string,
  rehydration?: RehydratedAgentState,
  mcpServer?: Pick<EmbeddedMcpServer, 'url' | 'authToken'>,
  environment?: ProvisionedEnvironment,
  logStore?: LogStore,
  beforeStepNotification?: string,
  gateWaiter?: GateWaiter,
): Promise<unknown> {
  const initialPrompt = await resolveDynamicProperty(agent.prompt, ctx)
  const sessionId = rehydration?.sessionId ?? await resolveSessionId(agent.sessionId, ctx)
  const maxTotalTurns = step.maxTotalTurns ?? DEFAULT_MAX_TOTAL_TURNS
  const resolvedEnv = environment
    ?? ctx.environments[step.id]
    ?? ctx.environments.host
    ?? createDefaultHostEnvironment(process.cwd())
  let attempt = rehydration?.attempt ?? 1
  let currentPrompt = resolveInitialPrompt(initialPrompt, runDir, step.id, rehydration, ctx.matrix?.index, mcpServer?.url)
  if (attempt === 1 && typeof beforeStepNotification === 'string' && beforeStepNotification.length > 0) {
    currentPrompt = `${beforeStepNotification}\n\n${currentPrompt}`
  }
  const scope: AgentTurnExecutionScope = {
    step,
    agent,
    ctx,
    snapshot,
    runDir,
    sessionId,
    initialPrompt,
    maxTotalTurns,
    environment: resolvedEnv,
    mcpServer,
    logStore,
    gateWaiter,
    activeGate: rehydration?.activeGate,
    activeStepOutput: rehydration?.activeStepOutput,
  }

  while (true) {
    const outcome = await runTurnLoopAttempt(scope, currentPrompt, attempt)
    if (outcome.success) {
      return outcome.result
    }
    currentPrompt = outcome.nextPrompt
    attempt += 1
  }
}
