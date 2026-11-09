import type { DynamicProperty, EnvironmentAdapter, ProvisionedEnvironment, StepContext } from './context.js'

export type GuardrailStatus = 'pass' | 'fail' | 'skip'
export type GuardrailPhase = 'beforeStep' | 'afterStep'
export type OnMaxRetriesExceededAction = 'abort' | 'prompt_user'
export type ExecLogPaginationSelector = (data: unknown) => readonly unknown[]
export type ExecLogPaginationConfig = string | { readonly key: string } | ExecLogPaginationSelector

export interface GuardrailVerdict<TBody = unknown> {
  status: GuardrailStatus
  body?: TBody
  logKey?: string
  rawLog?: string
  logFormat?: 'text' | 'json'
  pagination?: ExecLogPaginationConfig
}

export interface GuardrailExecutionInput<TContext = StepContext> {
  ctx: TContext
  stepId: string
  phase: GuardrailPhase
  guardrailIndex: number
  attempt: number
  runDir: string
  environment: ProvisionedEnvironment
  mcpServerUrl: string
  mcpAuthToken: string
}

export interface Guardrail<TBody = unknown, TContext = StepContext> {
  readonly __kind: 'guardrail'
  readonly type: 'fn' | 'exec' | 'agent' | 'human_review'
  readonly maxRetries?: number
  readonly onMaxRetriesExceeded?: OnMaxRetriesExceededAction
  readonly environment?: DynamicProperty<ProvisionedEnvironment | EnvironmentAdapter, TContext>
  execute: (input: GuardrailExecutionInput<TContext>) => Promise<GuardrailVerdict<TBody>>
}

export function isGuardrail(value: unknown): value is Guardrail {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const candidate = value as Record<string, unknown>
  const hasValidKind = candidate.__kind === 'guardrail'
  const hasValidType = candidate.type === 'fn'
    || candidate.type === 'exec'
    || candidate.type === 'agent'
    || candidate.type === 'human_review'
  const hasValidExecute = typeof candidate.execute === 'function'
  return hasValidKind && hasValidType && hasValidExecute
}
