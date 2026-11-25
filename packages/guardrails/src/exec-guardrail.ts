import type {
  DynamicProperty,
  ExecLogPaginationConfig,
  Guardrail,
  GuardrailExecutionInput,
  GuardrailStatus,
  GuardrailVerdict,
  HostSpawnResult,
  OnMaxRetriesExceededAction,
  StepContext,
} from '@luddjs/core'
import { resolveDynamicProperty, spawn } from '@luddjs/core'
import {
  resolveGuardrailExecutionOverrides,
  validateCwdAndEnvConfig,
} from './utils/execution-overrides.js'

export interface ExecGuardrailConfig<
  TBody = unknown,
  TContext extends StepContext<any, any, any, any> = StepContext,
> {
  name?: string
  command: DynamicProperty<string | readonly string[], TContext>
  cwd?: DynamicProperty<string, TContext>
  env?: DynamicProperty<Record<string, string>, TContext>
  maxRetries?: number
  onMaxRetriesExceeded?: OnMaxRetriesExceededAction
  timeout?: number
  onTimeout?: GuardrailStatus
  formatter?: (result: HostSpawnResult) => GuardrailVerdict<TBody> | Promise<GuardrailVerdict<TBody>>
  pagination?: ExecLogPaginationConfig
}

function isValidCommandArray(cmd: unknown): cmd is readonly [string, ...string[]] {
  return Array.isArray(cmd)
    && cmd.length > 0
    && cmd.every((c: unknown): c is string => typeof c === 'string')
    && cmd[0].trim() !== ''
}

function isValidCommand(cmd: unknown): boolean {
  if (typeof cmd === 'function') {
    return true
  }
  if (typeof cmd === 'string' && cmd.trim() !== '') {
    return true
  }
  return isValidCommandArray(cmd)
}

function parseExecCommand(command: unknown): {
  file: string
  args: readonly string[]
  shell: boolean
} {
  if (Array.isArray(command)) {
    if (!isValidCommandArray(command)) {
      throw new TypeError(
        'execGuardrail "command" array must start with a non-empty string and contain only strings.',
      )
    }
    return {
      file: command[0],
      args: command.slice(1),
      shell: false,
    }
  }
  if (typeof command === 'string' && command.trim() !== '') {
    return {
      file: command,
      args: [],
      shell: true,
    }
  }
  throw new TypeError(
    'execGuardrail "command" must resolve to a non-empty string or non-empty array of strings.',
  )
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

function validatePaginationConfig(pagination?: unknown): void {
  if (pagination === undefined) {
    return
  }
  if (typeof pagination === 'function') {
    return
  }
  if (typeof pagination === 'string' && pagination.trim() !== '') {
    return
  }
  if (
    typeof pagination === 'object'
    && pagination !== null
    && !Array.isArray(pagination)
    && typeof (pagination as Record<string, unknown>).key === 'string'
    && (pagination as { key: string }).key.trim() !== ''
  ) {
    return
  }
  throw new TypeError(
    'execGuardrail "pagination" must be a non-empty string, an object with a "key" string property, or a selector function.',
  )
}

function validateExecConfig<TBody, TContext extends StepContext<any, any, any, any>>(
  config: ExecGuardrailConfig<TBody, TContext>,
): void {
  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    throw new TypeError('execGuardrail configuration must be a non-null object.')
  }
  if (config.name !== undefined && (typeof config.name !== 'string' || config.name.trim() === '')) {
    throw new TypeError('execGuardrail "name" must be a non-empty string.')
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
  validateCwdAndEnvConfig('execGuardrail', config.cwd, config.env)
  validateExecRetries(config.maxRetries, config.onMaxRetriesExceeded)
  validatePaginationConfig(config.pagination)
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

function resolveLogFormat(
  pagination?: ExecLogPaginationConfig,
  explicitFormat?: 'text' | 'json',
): 'text' | 'json' | undefined {
  if (explicitFormat !== undefined) {
    return explicitFormat
  }
  if (pagination !== undefined) {
    return 'json'
  }
  return undefined
}

async function resolveExecutionVerdict<TBody>(
  result: HostSpawnResult,
  combinedOutput: string,
  config: ExecGuardrailConfig<TBody, any>,
): Promise<GuardrailVerdict<TBody>> {
  if (result.timedOut) {
    return {
      status: config.onTimeout ?? 'fail',
      body: 'Command timed out' as unknown as TBody,
      rawLog: combinedOutput,
      pagination: config.pagination,
      logFormat: resolveLogFormat(config.pagination),
    }
  }

  if (config.formatter !== undefined) {
    const verdict = await config.formatter(result)
    const rawLog = resolveRawLog(verdict.rawLog, verdict.status, combinedOutput)
    const pagination = verdict.pagination ?? config.pagination
    return {
      ...verdict,
      rawLog,
      pagination,
      logFormat: resolveLogFormat(pagination, verdict.logFormat),
    }
  }

  if (result.exitCode === 0) {
    return {
      status: 'pass',
      ...(combinedOutput !== ''
        ? { rawLog: combinedOutput }
        : {}),
      pagination: config.pagination,
      logFormat: resolveLogFormat(config.pagination),
    }
  }

  return {
    status: 'fail',
    rawLog: combinedOutput,
    pagination: config.pagination,
    logFormat: resolveLogFormat(config.pagination),
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
    ...(config.name !== undefined
      ? { name: config.name }
      : {}),
    maxRetries: config.maxRetries,
    onMaxRetriesExceeded: config.onMaxRetriesExceeded,
    execute: async (input: GuardrailExecutionInput<TContext>): Promise<GuardrailVerdict<TBody>> => {
      const command = await resolveDynamicProperty(config.command, input.ctx)
      const { file, args, shell } = parseExecCommand(command)
      const { cwd, env } = await resolveGuardrailExecutionOverrides(
        input.cwd,
        input.env,
        config,
        input.ctx,
        'execGuardrail',
      )
      const timeoutMs = config.timeout !== undefined
        ? config.timeout * 1000
        : undefined
      const result = await spawn({
        command: file,
        args,
        cwd,
        env: {
          ...env,
          MCP_SERVER_URL: input.mcpServerUrl,
          MCP_AUTH_TOKEN: input.mcpAuthToken,
        },
        ...(input.signal === undefined
          ? {}
          : { signal: input.signal }),
        timeoutMs,
        shell,
      })
      const combinedOutput = [result.stdout, result.stderr].filter(Boolean).join('\n')
      return resolveExecutionVerdict(result, combinedOutput, config)
    },
  }
}
