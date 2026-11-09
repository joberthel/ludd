import { describe, expect, it } from 'vitest'
import * as environments from './index.js'

describe('@ludd/environments package index', () => {
  it('exports hostEnv function', () => {
    expect(typeof environments.hostEnv).toBe('function')
  })
})
