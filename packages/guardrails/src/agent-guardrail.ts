import type {
  AgentAccessMode,
  AgentRunner,
  AgentTurnResult,
  DynamicProperty,
  ExecLogPaginationConfig,
  Guardrail,
  GuardrailExecutionInput,
  GuardrailStatus,
  GuardrailVerdict,
  OnMaxRetriesExceededAction,
  StepContext,
} from '@luddjs/core'
import { randomUUID } from 'node:crypto'
import { piAgent } from '@luddjs/agents'
import {
  extractAbortError,
  isAgentRunner,
  resolveDynamicProperty,
  StepOutputValidationError,
} from '@luddjs/core'
import { z } from 'zod'
import {
  resolveGuardrailExecutionOverrides,
  validateCwdAndEnvConfig,
} from './utils/execution-overrides.js'

export interface AgentGuardrailConfig<
  TBody = unknown,
  TContext extends StepContext<any, any, any, any> = StepContext,
> {
  name?: string
  mode?: AgentAccessMode
  maxRetries?: number
  onMaxRetriesExceeded?: OnMaxRetriesExceededAction
  bodySchema?: z.ZodType<TBody>
  prompt: DynamicProperty<string, TContext>
  /** Defaults to `piAgent({ mode, prompt, sessionId: fresh })` from `@luddjs/agents`. */
  agent?: AgentRunner<any, any>
  cwd?: DynamicProperty<string, TContext>
  env?: DynamicProperty<Record<string, string>, TContext>
  pagination?: ExecLogPaginationConfig
}

function validateRetries(
  maxRetries?: number,
  onMaxRetriesExceeded?: OnMaxRetriesExceededAction,
): void {
  const isInvalidRetries = maxRetries !== undefined
    && (typeof maxRetries !== 'number' || !Number.isInteger(maxRetries) || maxRetries < 0)
  if (isInvalidRetries) {
    throw new TypeError('agentGuardrail "maxRetries" must be a non-negative integer.')
  }
  const isInvalidAction = onMaxRetriesExceeded !== undefined
    && onMaxRetriesExceeded !== 'abort'
    && onMaxRetriesExceeded !== 'prompt_user'
  if (isInvalidAction) {
    throw new TypeError('agentGuardrail "onMaxRetriesExceeded" must be "abort" or "prompt_user".')
  }
}

function isValidPagination(p: unknown): boolean {
  if (p === undefined || typeof p === 'function') {
    return true
  }
  if (typeof p === 'string' && p.trim() !== '') {
    return true
  }
  return typeof p === 'object' && p !== null && !Array.isArray(p)
    && typeof (p as Record<string, unknown>).key === 'string'
    && (p as { key: string }).key.trim() !== ''
}

function validatePagination(pagination?: unknown): void {
  if (!isValidPagination(pagination)) {
    throw new TypeError(
      'agentGuardrail "pagination" must be a non-empty string, an object with a "key" string property, or a selector function.',
    )
  }
}

function validateAgentGuardrailConfig<TBody, TContext extends StepContext<any, any, any, any>>(
  config: AgentGuardrailConfig<TBody, TContext>,
): void {
  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    throw new TypeError('agentGuardrail configuration must be a non-null object.')
  }
  if (config.name !== undefined && (typeof config.name !== 'string' || config.name.trim() === '')) {
    throw new TypeError('agentGuardrail "name" must be a non-empty string.')
  }
  if (config.agent !== undefined && !isAgentRunner(config.agent)) {
    throw new TypeError('agentGuardrail "agent" must be a valid AgentRunner.')
  }
  const isValidPrompt = (typeof config.prompt === 'string' && config.prompt.trim() !== '') || typeof config.prompt === 'function'
  if (!isValidPrompt) {
    throw new TypeError('agentGuardrail "prompt" must be a non-empty string or function.')
  }
  if (config.mode !== undefined && config.mode !== 'read-only' && config.mode !== 'workspace-write') {
    throw new TypeError('agentGuardrail "mode" must be "read-only" or "workspace-write".')
  }
  const isInvalidSchema = config.bodySchema !== undefined
    && (typeof config.bodySchema !== 'object' || config.bodySchema === null || typeof (config.bodySchema as { safeParseAsync?: unknown }).safeParseAsync !== 'function')
  if (isInvalidSchema) {
    throw new TypeError('agentGuardrail "bodySchema" must be a valid Zod schema.')
  }
  validateCwdAndEnvConfig('agentGuardrail', config.cwd, config.env)
  validateRetries(config.maxRetries, config.onMaxRetriesExceeded)
  validatePagination(config.pagination)
}

function serializeFailBody(body: unknown): string | undefined {
  if (typeof body === 'string') {
    return body
  }
  return body !== undefined
    ? JSON.stringify(body, null, 2)
    : undefined
}

function resolveVerdict<TBody>(
  status: GuardrailStatus,
  body: TBody,
  pagination?: ExecLogPaginationConfig,
): GuardrailVerdict<TBody> {
  const isJson = pagination !== undefined || status === 'fail'
  return {
    status,
    body,
    rawLog: status === 'fail'
      ? serializeFailBody(body)
      : undefined,
    logFormat: isJson ? 'json' : undefined,
    pagination,
  }
}

async function runGuardrailAgentTurn<TContext extends StepContext<any, any, any, any>>(
  agent: AgentRunner<any, any>,
  input: GuardrailExecutionInput<TContext>,
  prompt: string,
  sessionId: string,
  mode: AgentAccessMode,
  cwd: string,
  env: Record<string, string>,
  verdictSchema: z.ZodType,
): Promise<AgentTurnResult<unknown>> {
  let turnResult: AgentTurnResult<unknown>
  try {
    turnResult = await agent.executeTurn({
      ctx: input.ctx,
      stepId: input.stepId,
      prompt,
      sessionId,
      attempt: input.attempt,
      mode,
      runDir: input.runDir,
      cwd,
      env,
      ...(input.signal === undefined
        ? {}
        : { signal: input.signal }),
      ...(input.mcpServerUrl !== ''
        ? {
            mcp: {
              url: input.mcpServerUrl,
              authToken: input.mcpAuthToken,
            },
          }
        : {}),
      outputSchema: verdictSchema,
    })
  }
  catch (err: unknown) {
    if (input.signal?.aborted) {
      throw extractAbortError(input.signal)
    }
    throw err
  }
  if (input.signal?.aborted) {
    throw extractAbortError(input.signal)
  }
  return turnResult
}

async function executeAgentTurn<TBody, TContext extends StepContext<any, any, any, any>>(
  config: AgentGuardrailConfig<TBody, TContext>,
  input: GuardrailExecutionInput<TContext>,
  mode: AgentAccessMode,
  sessionId: string,
): Promise<GuardrailVerdict<TBody>> {
  const prompt = await resolveDynamicProperty(config.prompt, input.ctx)
  if (typeof prompt !== 'string' || prompt.trim() === '') {
    throw new TypeError('agentGuardrail prompt cannot be empty.')
  }
  const { cwd, env } = await resolveGuardrailExecutionOverrides(
    input.cwd,
    input.env,
    config,
    input.ctx,
    'agentGuardrail',
  )

  const verdictSchema = z.object({
    status: z.enum(['pass', 'fail', 'skip']),
    body: (config.bodySchema ?? z.unknown().optional()) as z.ZodType<TBody>,
  })
  const agent = config.agent ?? piAgent({ mode, prompt, sessionId })
  const turnResult = await runGuardrailAgentTurn(
    agent,
    input,
    prompt,
    sessionId,
    mode,
    cwd,
    env,
    verdictSchema,
  )

  const parsed = await verdictSchema.safeParseAsync(turnResult.output)
  if (!parsed.success) {
    throw new StepOutputValidationError(input.stepId, turnResult.output, parsed.error.issues)
  }
  return resolveVerdict<TBody>(parsed.data.status, parsed.data.body, config.pagination)
}

export function agentGuardrail<
  TBody = unknown,
  TContext extends StepContext<any, any, any, any> = StepContext,
>(
  config: AgentGuardrailConfig<TBody, TContext>,
): Guardrail<TBody, TContext> {
  validateAgentGuardrailConfig(config)
  const mode = config.mode ?? 'read-only'

  return {
    __kind: 'guardrail',
    type: 'agent',
    ...(config.name !== undefined
      ? { name: config.name }
      : {}),
    maxRetries: config.maxRetries,
    onMaxRetriesExceeded: config.onMaxRetriesExceeded,
    execute: async (
      input: GuardrailExecutionInput<TContext>,
    ): Promise<GuardrailVerdict<TBody>> => {
      const sessionId = `guardrail-session-${randomUUID()}`
      return executeAgentTurn(config, input, mode, sessionId)
    },
  }
}
