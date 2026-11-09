import { describe, expect, it } from 'vitest'
import { execGuardrail } from '../exec-guardrail.js'

describe('execGuardrail configuration validation: basic properties', () => {
  it('rejects non-object configurations', () => {
    expect(() => execGuardrail(null as any)).toThrow(TypeError)
    expect(() => execGuardrail('echo' as any)).toThrow(TypeError)
    expect(() => execGuardrail([] as any)).toThrow(
      'execGuardrail configuration must be a non-null object.',
    )
  })

  it('rejects invalid command property', () => {
    expect(() => execGuardrail({} as any)).toThrow(
      'execGuardrail "command" must be a non-empty string, a non-empty array of strings, or a function.',
    )
    expect(() => execGuardrail({ command: '' })).toThrow(TypeError)
    expect(() => execGuardrail({ command: '   ' })).toThrow(TypeError)
    expect(() => execGuardrail({ command: [] })).toThrow(TypeError)
    expect(() => execGuardrail({
      command: [123 as any],
    })).toThrow(TypeError)
    expect(() => execGuardrail({
      command: 123 as any,
    })).toThrow(TypeError)
  })

  it('accepts valid command configurations', () => {
    expect(() => execGuardrail({ command: 'echo ok' })).not.toThrow()
    expect(() => execGuardrail({
      command: ['git', 'status'],
    })).not.toThrow()
    expect(() => execGuardrail({
      command: () => 'git status',
    })).not.toThrow()
  })
})

describe('execGuardrail configuration validation: advanced properties', () => {
  it('validates timeout configuration', () => {
    expect(() => execGuardrail({ command: 'echo', timeout: 0 })).toThrow(
      'execGuardrail "timeout" must be a positive number in seconds.',
    )
    expect(() => execGuardrail({ command: 'echo', timeout: -5 })).toThrow(TypeError)
    expect(() => execGuardrail({ command: 'echo', timeout: Number.NaN })).toThrow(TypeError)
    expect(() => execGuardrail({ command: 'echo', timeout: '10' as any })).toThrow(TypeError)
    expect(() => execGuardrail({ command: 'echo', timeout: 10 })).not.toThrow()
  })

  it('validates onTimeout configuration', () => {
    expect(() => execGuardrail({ command: 'echo', onTimeout: 'invalid' as any })).toThrow(
      'execGuardrail "onTimeout" must be "pass", "fail", or "skip".',
    )
    expect(() => execGuardrail({ command: 'echo', onTimeout: 'pass' })).not.toThrow()
    expect(() => execGuardrail({ command: 'echo', onTimeout: 'fail' })).not.toThrow()
    expect(() => execGuardrail({ command: 'echo', onTimeout: 'skip' })).not.toThrow()
  })

  it('validates formatter configuration', () => {
    expect(() => execGuardrail({
      command: 'echo',
      formatter: 'not-a-fn' as any,
    })).toThrow('execGuardrail "formatter" must be a function when provided.')
    expect(() => execGuardrail({
      command: 'echo',
      formatter: () => ({ status: 'pass' }),
    })).not.toThrow()
  })

  it('validates maxRetries and onMaxRetriesExceeded configuration', () => {
    expect(() => execGuardrail({ command: 'echo', maxRetries: -1 })).toThrow(
      'execGuardrail "maxRetries" must be a non-negative integer.',
    )
    expect(() => execGuardrail({ command: 'echo', maxRetries: 1.5 })).toThrow(TypeError)
    expect(() => execGuardrail({ command: 'echo', onMaxRetriesExceeded: 'invalid' as any })).toThrow(
      'execGuardrail "onMaxRetriesExceeded" must be "abort" or "prompt_user".',
    )
    expect(() => execGuardrail({ command: 'echo', maxRetries: 2, onMaxRetriesExceeded: 'abort' })).not.toThrow()
  })
})
