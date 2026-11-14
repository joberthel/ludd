import type { HarnessConfig } from '../types/harness.js'
import { access } from 'node:fs/promises'
import path from 'node:path'
import { createJiti } from 'jiti'
import * as zodModule from 'zod'
import { validateHarnessConfig } from '../define-harness.js'
import { HarnessConfigLoadError } from '../errors/harness-config-load-error.js'
import * as coreModule from '../index.js'

export interface LoadHarnessConfigOptions {
  virtualModules?: Record<string, unknown>
}

const OPTIONAL_WORKSPACE_PACKAGES = [
  '@ludd/agents',
  '@ludd/guardrails',
  '@ludd/environments',
] as const

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

async function resolveOptionalPackage(specifier: string): Promise<Record<string, unknown> | undefined> {
  try {
    const resolved = import.meta.resolve(specifier)
    return await import(resolved) as Record<string, unknown>
  }
  catch (cause: unknown) {
    const code = (cause as NodeJS.ErrnoException).code
    if (code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND') {
      return undefined
    }
    throw cause
  }
}

export async function loadHarnessConfig(
  configPath: string,
  options?: LoadHarnessConfigOptions,
): Promise<HarnessConfig> {
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

  const virtualModules: Record<string, unknown> = {
    '@ludd/core': coreModule,
    'zod': zodModule,
  }

  for (const pkg of OPTIONAL_WORKSPACE_PACKAGES) {
    if (options?.virtualModules && pkg in options.virtualModules) {
      continue
    }
    const mod = await resolveOptionalPackage(pkg)
    if (mod !== undefined) {
      virtualModules[pkg] = mod
    }
  }

  if (options?.virtualModules) {
    Object.assign(virtualModules, options.virtualModules)
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
