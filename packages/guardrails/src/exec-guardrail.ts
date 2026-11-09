import type {
  DynamicProperty,
  EnvironmentExecResult,
  ExecLogPaginationConfig,
  Guardrail,
  GuardrailExecutionInput,
  GuardrailStatus,
  GuardrailVerdict,
  OnMaxRetriesExceededAction,
  ProvisionedEnvironment,
  StepContext,
} from '@ludd/core'
import { resolveDynamicProperty } from '@ludd/core'

export interface ExecGuardrailConfig<
  TBody = unknown,
  TContext extends StepContext<any, any, any, any> = StepContext,
> {
  command: DynamicProperty<string | readonly string[], TContext>
  environment?: DynamicProperty<ProvisionedEnvironment, TContext>
  maxRetries?: number
  onMaxRetriesExceeded?: OnMaxRetriesExceededAction
  timeout?: number
  onTimeout?: GuardrailStatus
  formatter?: (result: EnvironmentExecResult) => GuardrailVerdict<TBody> | Promise<GuardrailVerdict<TBody>>
  pagination?: ExecLogPaginationConfig
}

function isValidCommand(cmd: unknown): boolean {
  if (typeof cmd === 'function') {
    return true
  }
  if (typeof cmd === 'string' && cmd.trim() !== '') {
    return true
  }
  return Array.isArray(cmd) && cmd.length > 0 && cmd.every((c: unknown) => typeof c === 'string')
}

function validateExecRetries(
  maxRetries?: number,
  onMaxRetriesExceeded?: OnMaxRetriesExceededAction,
): void {
  if (
    maxRetries !== undefined
    && (typeof maxRetries !== 'number'
      || !Number.isInteger(maxRetries)
      || maxRetries < 0)
  ) {
    throw new TypeError('execGuardrail "maxRetries" must be a non-negative integer.')
  }
  if (
    onMaxRetriesExceeded !== undefined
    && onMaxRetriesExceeded !== 'abort'
    && onMaxRetriesExceeded !== 'prompt_user'
  ) {
    throw new TypeError('execGuardrail "onMaxRetriesExceeded" must be "abort" or "prompt_user".')
  }
}

function validateExecConfig<TBody, TContext extends StepContext<any, any, any, any>>(
  config: ExecGuardrailConfig<TBody, TContext>,
): void {
  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    throw new TypeError('execGuardrail configuration must be a non-null object.')
  }
  if (!isValidCommand(config.command)) {
    throw new TypeError(
      'execGuardrail "command" must be a non-empty string, a non-empty array of strings, or a function.',
    )
  }
  if (config.timeout !== undefined && (typeof config.timeout !== 'number' || Number.isNaN(config.timeout) || config.timeout <= 0)) {
    throw new TypeError('execGuardrail "timeout" must be a positive number in seconds.')
  }
  if (config.onTimeout !== undefined && config.onTimeout !== 'pass' && config.onTimeout !== 'fail' && config.onTimeout !== 'skip') {
    throw new TypeError('execGuardrail "onTimeout" must be "pass", "fail", or "skip".')
  }
  if (config.formatter !== undefined && typeof config.formatter !== 'function') {
    throw new TypeError('execGuardrail "formatter" must be a function when provided.')
  }
  validateExecRetries(config.maxRetries, config.onMaxRetriesExceeded)
}

function resolveRawLog(
  verdictRawLog: string | undefined,
  status: GuardrailStatus,
  combinedOutput: string,
): string | undefined {
  if (verdictRawLog !== undefined) {
    return verdictRawLog
  }
  if (status === 'fail') {
    return combinedOutput
  }
  return undefined
}

async function resolveExecutionVerdict<TBody>(
  result: EnvironmentExecResult,
  combinedOutput: string,
  config: ExecGuardrailConfig<TBody, any>,
): Promise<GuardrailVerdict<TBody>> {
  if (result.timedOut) {
    return {
      status: config.onTimeout ?? 'fail',
      body: 'Command timed out' as unknown as TBody,
      rawLog: combinedOutput,
      pagination: config.pagination,
    }
  }

  if (config.formatter !== undefined) {
    const verdict = await config.formatter(result)
    const rawLog = resolveRawLog(verdict.rawLog, verdict.status, combinedOutput)
    return {
      ...verdict,
      rawLog,
      pagination: verdict.pagination ?? config.pagination,
    }
  }

  if (result.exitCode === 0) {
    return {
      status: 'pass',
      pagination: config.pagination,
    }
  }

  return {
    status: 'fail',
    rawLog: combinedOutput,
    pagination: config.pagination,
  }
}

export function execGuardrail<
  TBody = unknown,
  TContext extends StepContext<any, any, any, any> = StepContext,
>(config: ExecGuardrailConfig<TBody, TContext>): Guardrail<TBody, TContext> {
  validateExecConfig(config)

  return {
    __kind: 'guardrail',
    type: 'exec',
    maxRetries: config.maxRetries,
    onMaxRetriesExceeded: config.onMaxRetriesExceeded,
    environment: config.environment,
    execute: async (input: GuardrailExecutionInput<TContext>): Promise<GuardrailVerdict<TBody>> => {
      const command = await resolveDynamicProperty(config.command, input.ctx)
      const timeoutMs = config.timeout !== undefined
        ? config.timeout * 1000
        : undefined
      const result = await input.environment.exec(command, {
        timeoutMs,
        env: {
          MCP_SERVER_URL: input.mcpServerUrl,
          MCP_AUTH_TOKEN: input.mcpAuthToken,
        },
      })
      const combinedOutput = [result.stdout, result.stderr].filter(Boolean).join('\n')
      return resolveExecutionVerdict(result, combinedOutput, config)
    },
  }
}
