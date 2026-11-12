import type { HarnessConfig } from '../types/harness.js'
import { access } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createJiti } from 'jiti'
import { defineHarness, validateHarnessConfig } from '../define-harness.js'
import { HarnessConfigError } from '../errors/harness-config-error.js'
import { HarnessConfigLoadError } from '../errors/harness-config-load-error.js'
import { DEFAULT_MAX_TOTAL_TURNS, MaxTotalTurnsExceededError } from '../errors/max-total-turns-exceeded-error.js'
import { RunAlreadyActiveError } from '../errors/run-already-active-error.js'
import { RunAlreadyExistsError } from '../errors/run-already-exists-error.js'
import { SchemaVersionMismatchError } from '../errors/schema-version-mismatch-error.js'
import { StepOutputValidationError } from '../errors/step-output-validation-error.js'
import { appendLedgerEvent, readLedgerEvents } from '../persistence/ledger-writer.js'
import { acquireRunPidLock, isProcessAlive, releaseRunPidLock } from '../persistence/pid-lock.js'
import { readRunState, resolveRunDir, SUPPORTED_SCHEMA_VERSION, writeRunStateAtomic } from '../persistence/state-store.js'
import { appendStreamEvent, readStreamEvents, resolveStreamPath } from '../persistence/stream-writer.js'
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
    DEFAULT_MAX_TOTAL_TURNS,
    HarnessConfigError,
    HarnessConfigLoadError,
    MaxTotalTurnsExceededError,
    RunAlreadyActiveError,
    RunAlreadyExistsError,
    SUPPORTED_SCHEMA_VERSION,
    SchemaVersionMismatchError,
    StepOutputValidationError,
    acquireRunPidLock,
    appendLedgerEvent,
    appendStreamEvent,
    defineHarness,
    isAgentRunner,
    isProcessAlive,
    loadHarnessConfig,
    readLedgerEvents,
    readRunState,
    readStreamEvents,
    releaseRunPidLock,
    resolveDynamicProperty,
    resolveRunDir,
    resolveStreamPath,
    runHarness,
    validateHarnessConfig,
    writeRunStateAtomic,
  }
}

async function loadAgentsModule(): Promise<Record<string, unknown>> {
  const currentDir = path.dirname(fileURLToPath(import.meta.url))
  const packageDir = path.resolve(currentDir, '../../../agents')
  const builtEntry = path.join(packageDir, 'dist/index.js')
  try {
    await access(builtEntry)
    return await import(builtEntry) as Record<string, unknown>
  }
  catch (cause: unknown) {
    if ((cause as NodeJS.ErrnoException).code !== 'ENOENT')
      throw cause
  }

  // Source tests can run before packages have been built; production uses the
  // agents package's compiled entrypoint above.
  const sourceEntry = path.join(packageDir, 'src/index.ts')
  return import(sourceEntry) as Promise<Record<string, unknown>>
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

  const agentsModule = await loadAgentsModule()
  const virtualModules: Record<string, unknown> = {
    '@ludd/core': createCoreModule(),
    '@ludd/agents': agentsModule,
  }

  const jiti = createJiti(import.meta.url, {
    moduleCache: false,
    interopDefault: false,
    virtualModules,
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
