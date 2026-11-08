import { describe, expect, it } from 'vitest'
import { HarnessConfigLoadError } from './harness-config-load-error.js'

describe('harnessConfigLoadError class structure and properties', () => {
  it('instantiates correctly with message and configPath', () => {
    const error = new HarnessConfigLoadError(
      'Failed to load config',
      '/workspace/harness.config.ts',
    )

    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(HarnessConfigLoadError)
    expect(error.name).toBe('HarnessConfigLoadError')
    expect(error.message).toBe('Failed to load config')
    expect(error.configPath).toBe('/workspace/harness.config.ts')
    expect(error.cause).toBeUndefined()
  })

  it('preserves underlying cause when options are supplied', () => {
    const innerError = new Error('Syntax error on line 4')
    const error = new HarnessConfigLoadError(
      'Failed to evaluate config',
      '/workspace/broken.config.ts',
      { cause: innerError },
    )

    expect(error.cause).toBe(innerError)
  })
})
