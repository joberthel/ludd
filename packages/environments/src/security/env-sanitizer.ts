import process from 'node:process'

export const SAFE_BASELINE_KEYS = [
  'PATH',
  'HOME',
  'USER',
  'LANG',
  'LC_ALL',
  'TERM',
  'TMPDIR',
] as const

export interface BuildIsolatedEnvOptions {
  hostProcessEnv?: NodeJS.ProcessEnv
  whitelistEnv?: readonly string[]
  staticEnv?: Record<string, string>
  injectedEnv?: Record<string, string>
}

export function buildIsolatedEnvironmentVars(
  options?: BuildIsolatedEnvOptions,
): Record<string, string> {
  const host = options?.hostProcessEnv ?? process.env
  const result: Record<string, string> = {}

  for (const key of SAFE_BASELINE_KEYS) {
    const value = host[key]
    if (value !== undefined) {
      result[key] = value
    }
  }

  if (options?.whitelistEnv) {
    for (const key of options.whitelistEnv) {
      const value = host[key]
      if (value !== undefined) {
        result[key] = value
      }
    }
  }

  if (options?.staticEnv) {
    for (const [key, value] of Object.entries(options.staticEnv)) {
      result[key] = value
    }
  }

  if (options?.injectedEnv) {
    for (const [key, value] of Object.entries(options.injectedEnv)) {
      result[key] = value
    }
  }

  return result
}
