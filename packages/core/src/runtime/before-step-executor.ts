import type { EmbeddedMcpServer } from '../types/artifact.js'
import type { ProvisionedEnvironment, StepContext } from '../types/context.js'
import type { Guardrail, GuardrailVerdict } from '../types/guardrail.js'
import type { StepConfig } from '../types/harness.js'
import type { LedgerEventType } from '../types/ledger.js'
import type { LogStore } from '../types/log.js'
import type { RunStateSnapshot } from '../types/state.js'
import type { GateWaiter } from './gate-waiter.js'
import process from 'node:process'
import { createLogStore } from '../mcp/log-store.js'
import { appendLedgerEvent } from '../persistence/ledger-writer.js'
import { writeRunStateAtomic } from '../persistence/state-store.js'
import { isGuardrail } from '../types/guardrail.js'
import { executeHumanReviewBeforeStepGuardrail } from './before-step-human-review.js'
import { createDefaultHostEnvironment, resolveGuardrailEnvironment } from './environment-manager.js'

export interface BeforeStepExecutionResult {
  readonly guardrailIndex: number
  readonly verdict: GuardrailVerdict
  readonly logKey: string
  readonly feedback?: string
}

export interface RunBeforeStepGuardrailsParams {
  readonly step: StepConfig
  readonly ctx: StepContext
  readonly snapshot: RunStateSnapshot
  readonly runDir: string
  readonly mcpServer?: Pick<EmbeddedMcpServer, 'url' | 'authToken'>
  readonly environment?: ProvisionedEnvironment
  readonly logStore?: LogStore
  readonly gateWaiter?: GateWaiter
  readonly startIndex?: number
}

export function formatBeforeStepNotification(
  results: readonly BeforeStepExecutionResult[],
): string {
  if (results.length === 0) {
    return ''
  }
  const lines = results.map(r =>
    `- Guardrail #${r.guardrailIndex}: logKey="${r.logKey}" (status: ${r.verdict.status})`,
  )
  const feedbackItems = results
    .filter(r => typeof r.feedback === 'string' && r.feedback.trim().length > 0)
    .map(r => `User feedback (Guardrail #${r.guardrailIndex}):\n${r.feedback}`)
  const feedbackSection = feedbackItems.length > 0
    ? `\n\n${feedbackItems.join('\n\n')}`
    : ''
  return `Context from beforeStep guardrails is available via MCP tools:\n${lines.join('\n')}\n\nYou can inspect these logs using MCP tools: read_log_page, read_log_lines, or search_log.${feedbackSection}`
}

export function emitBeforeStepEvent(
  runDir: string,
  ctx: StepContext,
  stepId: string,
  eventType: LedgerEventType,
  payload: Record<string, unknown>,
): void {
  appendLedgerEvent(runDir, {
    schemaVersion: 1,
    timestamp: new Date().toISOString(),
    runId: ctx.runId,
    stepId,
    matrixIndex: ctx.matrix?.index,
    eventType,
    payload,
  })
}

async function resolveGuardrailEnv(
  guardrail: Guardrail<any, any>,
  ctx: StepContext,
  stepId: string,
  stepEnvironment?: ProvisionedEnvironment,
  snapshot?: RunStateSnapshot,
  runDir?: string,
): Promise<ProvisionedEnvironment> {
  const fallback = stepEnvironment
    ?? ctx.environments[stepId]
    ?? ctx.environments.host
    ?? createDefaultHostEnvironment(process.cwd())
  return resolveGuardrailEnvironment(guardrail, ctx, fallback, snapshot, runDir)
}

function resolveBeforeStepContent(guardrailIndex: number, verdict: GuardrailVerdict): string {
  if (typeof verdict.rawLog === 'string') {
    return verdict.rawLog
  }
  if (typeof verdict.body === 'string') {
    return verdict.body
  }
  if (verdict.body !== undefined) {
    return JSON.stringify(verdict.body, null, 2)
  }
  return `Guardrail #${guardrailIndex} returned status: ${verdict.status}`
}

export async function offloadBeforeStepLog(
  runDir: string,
  snapshot: RunStateSnapshot,
  stepId: string,
  k: number,
  verdict: GuardrailVerdict,
  logStore: LogStore,
  matrixIndex?: number,
): Promise<string> {
  const content = resolveBeforeStepContent(k, verdict)
  const meta = await logStore.offload({
    stepId,
    attempt: 1,
    phase: 'beforeStep',
    guardrailIndex: k,
    matrixIndex,
    content,
    format: verdict.logFormat,
    pagination: verdict.pagination,
  })

  verdict.logKey = meta.logKey
  snapshot.logs = snapshot.logs ?? {}
  snapshot.logs[meta.logKey] = meta
  snapshot.updatedAt = new Date().toISOString()
  writeRunStateAtomic(runDir, snapshot)
  return meta.logKey
}

async function executeStandardBeforeStepGuardrail(
  params: RunBeforeStepGuardrailsParams,
  guardrail: Guardrail<any, any>,
  k: number,
  logStore: LogStore,
): Promise<BeforeStepExecutionResult> {
  const { step, ctx, runDir, mcpServer, environment, snapshot } = params
  const env = await resolveGuardrailEnv(guardrail, ctx, step.id, environment, snapshot, runDir)
  const verdict = await guardrail.execute({
    ctx,
    stepId: step.id,
    phase: 'beforeStep',
    guardrailIndex: k,
    attempt: 1,
    runDir,
    environment: env,
    mcpServerUrl: mcpServer?.url ?? '',
    mcpAuthToken: mcpServer?.authToken ?? '',
  })

  const eventType: LedgerEventType = verdict.status === 'pass'
    ? 'guardrail.passed'
    : verdict.status === 'skip'
      ? 'guardrail.skipped'
      : 'guardrail.failed'

  emitBeforeStepEvent(runDir, ctx, step.id, eventType, {
    phase: 'beforeStep',
    guardrailIndex: k,
    attempt: 1,
    verdict,
  })

  const logKey = await offloadBeforeStepLog(runDir, snapshot, step.id, k, verdict, logStore, ctx.matrix?.index)
  return { guardrailIndex: k, verdict, logKey }
}

async function executeSingleBeforeStepGuardrail(
  params: RunBeforeStepGuardrailsParams,
  guardrail: Guardrail<any, any>,
  k: number,
  logStore: LogStore,
): Promise<BeforeStepExecutionResult> {
  const { step, ctx, runDir } = params
  emitBeforeStepEvent(runDir, ctx, step.id, 'guardrail.started', {
    phase: 'beforeStep',
    guardrailIndex: k,
    attempt: 1,
  })

  return guardrail.type === 'human_review'
    ? executeHumanReviewBeforeStepGuardrail(params, guardrail, k, logStore)
    : executeStandardBeforeStepGuardrail(params, guardrail, k, logStore)
}

function initCollectedBeforeStepResults(
  isArray: boolean,
  activeBeforeStepResults: unknown,
): Record<string, unknown> | unknown[] {
  if (isArray) {
    return Array.isArray(activeBeforeStepResults)
      ? [...(activeBeforeStepResults as unknown[])]
      : []
  }
  if (activeBeforeStepResults !== null && typeof activeBeforeStepResults === 'object' && !Array.isArray(activeBeforeStepResults)) {
    return { ...(activeBeforeStepResults as Record<string, unknown>) }
  }
  return {}
}

export async function runBeforeStepGuardrails(
  params: RunBeforeStepGuardrailsParams,
): Promise<string> {
  const { step, runDir } = params
  const resolved = await resolveBeforeStepGuardrails(step, params.ctx)
  if (resolved.guardrails.length === 0) {
    const emptyResults = resolved.isArray
      ? []
      : {}
    ;(params.ctx as StepContext & { beforeStep: unknown }).beforeStep = emptyResults
    params.snapshot.activeBeforeStepResults = emptyResults
    return ''
  }
  const store = params.logStore ?? createLogStore(runDir)
  const results: BeforeStepExecutionResult[] = []
  const startIndex = params.startIndex ?? 0
  const collected = initCollectedBeforeStepResults(
    resolved.isArray,
    params.snapshot.activeBeforeStepResults,
  )

  for (let k = startIndex; k < resolved.guardrails.length; k++) {
    const { guardrail } = resolved.guardrails[k]
    const result = await executeSingleBeforeStepGuardrail(params, guardrail, k, store)
    results.push(result)
    if (resolved.isArray) {
      ;(collected as unknown[])[k] = result.verdict.body
    }
    else {
      ;(collected as Record<string, unknown>)[resolved.guardrails[k].key] = result.verdict.body
    }
    ;(params.ctx as StepContext & { beforeStep: unknown }).beforeStep = collected
    params.snapshot.activeBeforeStepResults = collected
    params.snapshot.updatedAt = new Date().toISOString()
    writeRunStateAtomic(runDir, params.snapshot)
  }

  return formatBeforeStepNotification(results)
}

async function resolveBeforeStepGuardrails(
  step: StepConfig,
  ctx: StepContext,
): Promise<{ isArray: boolean, guardrails: Array<{ key: string, guardrail: Guardrail }> }> {
  const beforeStep = typeof step.beforeStep === 'function'
    ? await step.beforeStep(ctx)
    : step.beforeStep
  if (beforeStep !== undefined && (typeof beforeStep !== 'object' || beforeStep === null)) {
    throw new TypeError(`Step "${step.id}" beforeStep factory must return an array or an object map.`)
  }
  const isArray = Array.isArray(beforeStep)
  let entries: Array<readonly [string, unknown]> = []
  if (beforeStep !== undefined) {
    entries = isArray
      ? beforeStep.map((guardrail, index) => [
          String(index),
          guardrail,
        ] as const)
      : Object.entries(beforeStep)
  }
  const guardrails: Array<{ key: string, guardrail: Guardrail }> = []
  for (const [key, value] of entries) {
    if (!isGuardrail(value)) {
      const location = isArray
        ? `index ${key}`
        : `key "${key}"`
      throw new TypeError(`Step "${step.id}" beforeStep factory returned an invalid Guardrail at ${location}.`)
    }
    guardrails.push({ key, guardrail: value })
  }
  return { isArray, guardrails }
}
