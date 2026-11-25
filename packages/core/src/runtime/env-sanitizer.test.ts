import { describe, expect, it } from 'vitest'
import { buildIsolatedEnvironmentVars } from './env-sanitizer.js'

describe('buildIsolatedEnvironmentVars', () => {
  it('defaults to process.env when hostProcessEnv is omitted and skips missing whitelist keys', () => {
    const result = buildIsolatedEnvironmentVars({
      whitelistEnv: ['DEFINITELY_MISSING_LUDD_KEY_78'],
    })
    expect(result).not.toHaveProperty('DEFINITELY_MISSING_LUDD_KEY_78')
    const defaultResult = buildIsolatedEnvironmentVars()
    expect(typeof defaultResult).toBe('object')
  })

  it('merges baseline, whitelisted, staticEnv, and injectedEnv in precedence order', () => {
    const result = buildIsolatedEnvironmentVars({
      hostProcessEnv: {
        PATH: '/usr/bin',
        SECRET_TOKEN: 'hidden',
        API_KEY: 'allowed-secret',
      },
      whitelistEnv: ['API_KEY'],
      staticEnv: {
        API_KEY: 'from-static',
        STATIC_ONLY: '1',
      },
      injectedEnv: {
        STATIC_ONLY: 'overridden-by-injected',
        INJECTED_ONLY: '2',
      },
    })

    expect(result).toEqual({
      PATH: '/usr/bin',
      API_KEY: 'from-static',
      STATIC_ONLY: 'overridden-by-injected',
      INJECTED_ONLY: '2',
    })
    expect(result).not.toHaveProperty('SECRET_TOKEN')
  })
})
