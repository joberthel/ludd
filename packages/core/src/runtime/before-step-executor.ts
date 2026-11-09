import type { EmbeddedMcpServer } from '../types/artifact.js'
import type { ProvisionedEnvironment, StepContext } from '../types/context.js'
import type { Guardrail, GuardrailVerdict } from '../types/guardrail.js'
import type { StepConfig } from '../types/harness.js'
import type { LedgerEventType } from '../types/ledger.js'
import type { LogStore } from '../types/log.js'
import type { RunStateSnapshot } from '../types/state.js'
import path from 'node:path'
import process from 'node:process'
import { createLogStore } from '../mcp/log-store.js'
import { appendLedgerEvent } from '../persistence/ledger-writer.js'
import { writeRunStateAtomic } from '../persistence/state-store.js'
import { createDefaultHostEnvironment, resolveGuardrailEnvironment } from './environment-manager.js'

export interface BeforeStepExecutionResult {
  readonly guardrailIndex: number
  readonly verdict: GuardrailVerdict
  readonly logKey: string
}

export interface RunBeforeStepGuardrailsParams {
  readonly step: StepConfig
  readonly ctx: StepContext
  readonly snapshot: RunStateSnapshot
  readonly runDir: string
  readonly mcpServer?: Pick<EmbeddedMcpServer, 'url' | 'authToken'>
  readonly environment?: ProvisionedEnvironment
  readonly logStore?: LogStore
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
  return `Context from beforeStep guardrails is available via MCP tools:\n${lines.join('\n')}\n\nYou can inspect these logs using MCP tools: read_log_page, read_log_lines, or search_log.`
}

function emitBeforeStepEvent(
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
): Promise<ProvisionedEnvironment> {
  const fallback = stepEnvironment
    ?? ctx.environments[stepId]
    ?? ctx.environments.host
    ?? createDefaultHostEnvironment(process.cwd())
  return resolveGuardrailEnvironment(guardrail, ctx, fallback)
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

async function offloadBeforeStepLog(
  runDir: string,
  snapshot: RunStateSnapshot,
  stepId: string,
  k: number,
  verdict: GuardrailVerdict,
  logStore: LogStore,
): Promise<string> {
  const content = resolveBeforeStepContent(k, verdict)
  const meta = await logStore.offload({
    stepId,
    attempt: 1,
    phase: 'beforeStep',
    guardrailIndex: k,
    content,
    format: verdict.logFormat,
    pagination: verdict.pagination,
  })

  verdict.logKey = meta.logKey
  snapshot.logs = snapshot.logs ?? {}
  snapshot.logs[meta.logKey] = meta
  snapshot.logs[`${stepId}-1`] = {
    ...meta,
    logKey: `${stepId}-1`,
    filePath: path.join('logs', `${stepId}-1.log`),
  }
  snapshot.updatedAt = new Date().toISOString()
  writeRunStateAtomic(runDir, snapshot)
  return meta.logKey
}

async function executeSingleBeforeStepGuardrail(
  params: RunBeforeStepGuardrailsParams,
  guardrail: Guardrail<any, any>,
  k: number,
  logStore: LogStore,
): Promise<BeforeStepExecutionResult> {
  const { step, ctx, runDir, mcpServer, environment, snapshot } = params
  emitBeforeStepEvent(runDir, ctx, step.id, 'guardrail.started', {
    phase: 'beforeStep',
    guardrailIndex: k,
    attempt: 1,
  })

  const env = await resolveGuardrailEnv(guardrail, ctx, step.id, environment)
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

  const logKey = await offloadBeforeStepLog(runDir, snapshot, step.id, k, verdict, logStore)
  return { guardrailIndex: k, verdict, logKey }
}

export async function runBeforeStepGuardrails(
  params: RunBeforeStepGuardrailsParams,
): Promise<string> {
  const { step, runDir } = params
  if (!step.beforeStep || step.beforeStep.length === 0) {
    return ''
  }

  const store = params.logStore ?? createLogStore(runDir)
  const results: BeforeStepExecutionResult[] = []

  for (let k = 0; k < step.beforeStep.length; k++) {
    const guardrail = step.beforeStep[k]
    const result = await executeSingleBeforeStepGuardrail(params, guardrail, k, store)
    results.push(result)
  }

  return formatBeforeStepNotification(results)
}
