import type { AgentRunner } from '../types/agent.js'
import type { EmbeddedMcpServer } from '../types/artifact.js'
import type { StepContext } from '../types/context.js'
import type { StepConfig } from '../types/harness.js'
import type { LogStore } from '../types/log.js'
import type { ActiveGateState, RunStateSnapshot } from '../types/state.js'
import type { RehydratedAgentPromptState } from './agent-prompt.js'
import type { ResolvedExecutionContext } from './execution-context.js'
import type { GateWaiter } from './gate-waiter.js'
import type { RunAfterStepGuardrailsParams } from './guardrail-executor.js'
import { randomUUID } from 'node:crypto'
import process from 'node:process'
import { StepArtifactValidationError } from '../errors/step-artifact-validation-error.js'
import { StepOutputValidationError } from '../errors/step-output-validation-error.js'
import { writeRunStateAtomic } from '../persistence/state-store.js'
import { resolveDynamicProperty } from '../utils/resolve-dynamic-property.js'
import { formatRetryPrompt, resolveInitialPrompt } from './agent-prompt.js'
import {
  createAgentStepOutput,
  resolveConfiguredSessionId,
  validateStepOutput,
} from './agent-step-output.js'
import { formatArtifactRetryPrompt, validateStepArtifacts } from './artifact-validator.js'
import {
  emitStepRetry,
  GuardrailRetrySignal,
  runAfterStepGuardrails,
} from './guardrail-executor.js'
import { extractAbortError } from './host-exec.js'
import { createInteractiveQuestionHandler } from './interactive-executor.js'

export type RehydratedAgentState = RehydratedAgentPromptState
export {
  createAgentStepOutput,
  formatRetryPrompt,
  resolveConfiguredSessionId,
  resolveInitialPrompt,
  validateStepOutput,
}

interface TurnRetryParams {
  stepId: string
  attempt: number
  runDir: string
  ctx: StepContext
  sessionId: string
  initialPrompt: string
  signal?: AbortSignal
}

function handleTurnRetry(err: unknown, params: TurnRetryParams): string {
  if (params.signal?.aborted) {
    throw extractAbortError(params.signal)
  }
  if (err instanceof GuardrailRetrySignal) {
    return err.prompt
  }
  if (
    !(err instanceof StepOutputValidationError)
    && !(err instanceof StepArtifactValidationError)
  ) {
    throw err
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

function syncReturnedSessionId(scope: AgentTurnExecutionScope, returnedSessionId: string, attempt: number): void {
  if (returnedSessionId !== scope.sessionId) {
    persistActiveTurn(scope.runDir, scope.snapshot, returnedSessionId, attempt)
  }
  scope.sessionId = returnedSessionId
  scope.previousSessionId = returnedSessionId
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
    isAgent: true,
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
  previousSessionId?: string
  initialPrompt: string
  cwd: string
  env: Record<string, string>
  signal?: AbortSignal
  mcpServer?: Pick<EmbeddedMcpServer, 'url' | 'authToken' | 'setAskUserHandler'>
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
      isAgent: true,
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
  if (scope.signal?.aborted) {
    throw extractAbortError(scope.signal)
  }
  scope.ctx.step.attempt = attempt
  if (scope.activeGate?.phase === 'afterStep') {
    const gate = scope.activeGate
    scope.activeGate = null
    return resumeAfterStepGate(scope, attempt, gate)
  }

  persistActiveTurn(scope.runDir, scope.snapshot, scope.sessionId, attempt)

  try {
    const turnResult = await scope.agent.executeTurn({
      ctx: scope.ctx,
      stepId: scope.step.id,
      prompt: currentPrompt,
      sessionId: scope.sessionId,
      ...(scope.previousSessionId === undefined
        ? {}
        : { previousSessionId: scope.previousSessionId }),
      attempt,
      mode: scope.agent.mode,
      runDir: scope.runDir,
      cwd: scope.cwd,
      env: scope.env,
      ...(scope.mcpServer === undefined
        ? {}
        : {
            mcp: {
              url: scope.mcpServer.url,
              authToken: scope.mcpServer.authToken,
            },
          }),
      ...(scope.step.outputSchema === undefined
        ? {}
        : { outputSchema: scope.step.outputSchema }),
      ...(scope.step.interactive !== undefined && scope.step.interactive !== false
        ? { interactive: true }
        : {}),
      signal: scope.signal,
    })
    if (scope.signal?.aborted) {
      throw extractAbortError(scope.signal)
    }

    syncReturnedSessionId(scope, turnResult.sessionId, attempt)

    const result = await finalizeAgentTurn(scope.step, turnResult, {
      ...scope,
      attempt,
    })
    return { success: true, result }
  }
  catch (err: unknown) {
    if (err instanceof StepOutputValidationError && err.sessionId !== undefined) {
      syncReturnedSessionId(scope, err.sessionId, attempt)
    }
    const nextPrompt = handleTurnRetry(err, {
      ...scope,
      stepId: scope.step.id,
      attempt,
    })
    return { success: false, nextPrompt }
  }
}

export interface AgentStepExecutionOptions extends Partial<ResolvedExecutionContext> {
  signal?: AbortSignal
}

export async function executeAgentStep(
  step: StepConfig,
  agent: AgentRunner,
  ctx: StepContext,
  snapshot: RunStateSnapshot,
  runDir: string,
  rehydration?: RehydratedAgentState,
  mcpServer?: Pick<EmbeddedMcpServer, 'url' | 'authToken' | 'setAskUserHandler'>,
  executionContext?: AgentStepExecutionOptions,
  logStore?: LogStore,
  beforeStepNotification?: string,
  gateWaiter?: GateWaiter,
): Promise<unknown> {
  const initialPrompt = await resolveDynamicProperty(agent.prompt, ctx)
  const explicitSessionId = rehydration?.sessionId ?? await resolveConfiguredSessionId(agent.sessionId, ctx)
  const sessionId = explicitSessionId ?? `session-${randomUUID()}`
  const cwd = executionContext?.cwd ?? process.cwd()
  const env = executionContext?.env ?? {}
  const signal = executionContext?.signal ?? gateWaiter?.signal
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
    previousSessionId: explicitSessionId,
    initialPrompt,
    cwd,
    env,
    signal,
    mcpServer,
    logStore,
    gateWaiter,
    activeGate: rehydration?.activeGate,
    activeStepOutput: rehydration?.activeStepOutput,
  }

  const askUserHandler = createInteractiveQuestionHandler({
    step,
    snapshot,
    runDir,
    matrixIndex: ctx.matrix?.index,
    gateWaiter,
  })
  mcpServer?.setAskUserHandler?.(askUserHandler)
  try {
    while (true) {
      const outcome = await runTurnLoopAttempt(scope, currentPrompt, attempt)
      if (outcome.success) {
        return outcome.result
      }
      currentPrompt = outcome.nextPrompt
      attempt += 1
    }
  }
  finally {
    mcpServer?.setAskUserHandler?.(undefined)
  }
}
