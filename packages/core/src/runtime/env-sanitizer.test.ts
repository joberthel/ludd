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
})
