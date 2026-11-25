import type { DynamicProperty } from '@luddjs/core'
import path from 'node:path'
import { resolveDynamicProperty } from '@luddjs/core'

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }
  const proto = Object.getPrototypeOf(value) as unknown
  return proto === Object.prototype || proto === null
}

/** Validates that a resolved `cwd` value is a non-empty trimmed string. */
export function validateResolvedCwdValue(cwd: unknown, prefix: string): asserts cwd is string {
  if (typeof cwd !== 'string' || cwd.trim() === '') {
    throw new TypeError(`${prefix} "cwd" must be a non-empty string.`)
  }
}

/** Validates that a resolved `env` record is a plain object mapping valid keys to string values. */
export function validateEnvRecordValue(env: unknown, prefix: string): asserts env is Record<string, string> {
  if (!isPlainRecord(env)) {
    throw new TypeError(`${prefix} "env" must be a plain object of string values.`)
  }
  for (const [key, value] of Object.entries(env)) {
    if (key.trim() === '' || key.includes('=') || key.includes('\0')) {
      throw new TypeError(`${prefix} "env" keys must be non-empty strings without "=" or null bytes.`)
    }
    if (typeof value !== 'string' || value.includes('\0')) {
      throw new TypeError(`${prefix} "env" entry "${key}" must be a string without null bytes.`)
    }
  }
}

/** Validates static `cwd` and `env` configuration properties at guardrail construction time. */
export function validateCwdAndEnvConfig(prefix: string, cwd?: unknown, env?: unknown): void {
  if (cwd !== undefined && typeof cwd !== 'function') {
    validateResolvedCwdValue(cwd, prefix)
  }
  if (env !== undefined && typeof env !== 'function') {
    validateEnvRecordValue(env, prefix)
  }
}

/** Resolves guardrail-level `cwd` and `env` overrides on top of the inherited step execution context. */
export async function resolveGuardrailExecutionOverrides<TContext>(
  baseCwd: string,
  baseEnv: Record<string, string>,
  config: {
    cwd?: DynamicProperty<string, TContext>
    env?: DynamicProperty<Record<string, string>, TContext>
  },
  ctx: TContext,
  prefix: string,
): Promise<{ cwd: string, env: Record<string, string> }> {
  let cwd = baseCwd
  if (config.cwd !== undefined) {
    const resolvedCwd = await resolveDynamicProperty(config.cwd, ctx)
    validateResolvedCwdValue(resolvedCwd, prefix)
    cwd = path.resolve(baseCwd, resolvedCwd)
  }

  let env = baseEnv
  if (config.env !== undefined) {
    const resolvedEnv = await resolveDynamicProperty(config.env, ctx)
    validateEnvRecordValue(resolvedEnv, prefix)
    env = {
      ...baseEnv,
      ...resolvedEnv,
    }
  }

  return { cwd, env }
}
