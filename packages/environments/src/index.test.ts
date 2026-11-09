import { describe, expect, it } from 'vitest'
import * as environments from './index.js'

describe('@ludd/environments package index', () => {
  it('exports hostEnv and gitWorktreeEnv functions', () => {
    expect(typeof environments.hostEnv).toBe('function')
    expect(typeof environments.gitWorktreeEnv).toBe('function')
    expect(typeof environments.killProcessTree).toBe('function')
  })
})
