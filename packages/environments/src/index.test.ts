import { describe, expect, it } from 'vitest'
import * as environments from './index.js'

describe('@ludd/environments package index', () => {
  it('exports hostEnv, gitWorktreeEnv, and dockerWorktreeEnv functions', () => {
    expect(typeof environments.hostEnv).toBe('function')
    expect(typeof environments.gitWorktreeEnv).toBe('function')
    expect(typeof environments.dockerWorktreeEnv).toBe('function')
    expect(typeof environments.killProcessTree).toBe('function')
    expect(typeof environments.translateMcpServerUrl).toBe('function')
    expect(typeof environments.buildIsolatedEnvironmentVars).toBe('function')
    expect(Array.isArray(environments.SAFE_BASELINE_KEYS)).toBe(true)
  })
})
