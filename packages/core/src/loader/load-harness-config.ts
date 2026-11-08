import type { HarnessConfig } from '../types/harness.js'
import { access } from 'node:fs/promises'
import path from 'node:path'
import { createJiti } from 'jiti'
import { defineHarness, validateHarnessConfig } from '../define-harness.js'
import { HarnessConfigError } from '../errors/harness-config-error.js'
import { HarnessConfigLoadError } from '../errors/harness-config-load-error.js'
import { StepOutputValidationError } from '../errors/step-output-validation-error.js'
import { runHarness } from '../runtime/run-harness.js'
import { isAgentRunner } from '../types/harness.js'
import { resolveDynamicProperty } from '../utils/resolve-dynamic-property.js'

function validateConfigPath(configPath: unknown): string {
  if (typeof configPath !== 'string' || configPath.trim() === '') {
    const fallbackPath = typeof configPath === 'string'
      ? configPath
      : ''
    throw new HarnessConfigLoadError(
      'Config path must be a non-empty trimmed string.',
      fallbackPath,
    )
  }
  return configPath
}

function formatErrorDetail(cause: unknown): string {
  if (cause instanceof Error) {
    return cause.message
  }
  return String(cause)
}

function createCoreModule(): Record<string, unknown> {
  return {
    defineHarness,
    validateHarnessConfig,
    HarnessConfigError,
    HarnessConfigLoadError,
    StepOutputValidationError,
    loadHarnessConfig,
    runHarness,
    isAgentRunner,
    resolveDynamicProperty,
  }
}

export async function loadHarnessConfig(configPath: string): Promise<HarnessConfig> {
  validateConfigPath(configPath)
  const resolvedPath = path.resolve(configPath)

  try {
    await access(resolvedPath)
  }
  catch (cause: unknown) {
    throw new HarnessConfigLoadError(
      `Failed to access harness config file at "${resolvedPath}".`,
      resolvedPath,
      { cause },
    )
  }

  const jiti = createJiti(import.meta.url, {
    moduleCache: false,
    interopDefault: false,
    virtualModules: {
      '@ludd/core': createCoreModule(),
    },
  })

  let mod: Record<string, unknown>
  try {
    mod = await jiti.import<Record<string, unknown>>(resolvedPath)
  }
  catch (cause: unknown) {
    throw new HarnessConfigLoadError(
      `Failed to load harness config from "${resolvedPath}": ${formatErrorDetail(cause)}`,
      resolvedPath,
      { cause },
    )
  }

  const rawConfig = mod.default !== undefined
    ? mod.default
    : mod

  try {
    return validateHarnessConfig(rawConfig)
  }
  catch (cause: unknown) {
    throw new HarnessConfigLoadError(
      `Failed to validate harness config at "${resolvedPath}": ${formatErrorDetail(cause)}`,
      resolvedPath,
      { cause },
    )
  }
}
