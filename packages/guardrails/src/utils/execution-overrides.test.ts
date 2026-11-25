import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  resolveGuardrailExecutionOverrides,
  validateCwdAndEnvConfig,
  validateEnvRecordValue,
  validateResolvedCwdValue,
} from './execution-overrides.js'

describe('execution-overrides validation', () => {
  it('validates cwd and env values and rejects invalid types/entries', () => {
    expect(() => validateCwdAndEnvConfig('test', '/valid', { A: '1' })).not.toThrow()
    expect(() => validateCwdAndEnvConfig('test', () => '/dyn', () => ({ A: '1' }))).not.toThrow()
    expect(() => validateCwdAndEnvConfig('test', undefined, undefined)).not.toThrow()

    expect(() => validateResolvedCwdValue('', 'execGuardrail')).toThrow(
      'execGuardrail "cwd" must be a non-empty string.',
    )
    expect(() => validateResolvedCwdValue('   ', 'execGuardrail')).toThrow(TypeError)
    expect(() => validateResolvedCwdValue(42, 'execGuardrail')).toThrow(TypeError)

    const nullProto = Object.assign(Object.create(null) as Record<string, string>, { OK: 'yes' })
    expect(() => validateEnvRecordValue(nullProto, 'execGuardrail')).not.toThrow()

    for (const invalidEnv of [
      null,
      'str',
      [],
      new Date(),
    ]) {
      expect(() => validateEnvRecordValue(invalidEnv, 'agentGuardrail')).toThrow(
        'agentGuardrail "env" must be a plain object of string values.',
      )
    }
    for (const badKey of [
      { '  ': '1' },
      { 'A=B': '1' },
      { 'A\0B': '1' },
    ]) {
      expect(() => validateEnvRecordValue(badKey, 'agentGuardrail')).toThrow(
        'agentGuardrail "env" keys must be non-empty strings without "=" or null bytes.',
      )
    }
    for (const badVal of [
      { K: 123 },
      { K: 'a\0b' },
    ]) {
      expect(() => validateEnvRecordValue(badVal, 'agentGuardrail')).toThrow(
        'agentGuardrail "env" entry "K" must be a string without null bytes.',
      )
    }
  })
})

describe('resolveGuardrailExecutionOverrides', () => {
  it('inherits base cwd/env when omitted and resolves static or dynamic overrides', async () => {
    const inherited = await resolveGuardrailExecutionOverrides('/base', { A: '1' }, {}, {}, 'execGuardrail')
    expect(inherited).toEqual({
      cwd: '/base',
      env: { A: '1' },
    })

    const overridden = await resolveGuardrailExecutionOverrides(
      '/base',
      { A: '1', B: 'base' },
      {
        cwd: 'sub/dir',
        env: async () => ({ B: 'override', C: '3' }),
      },
      {},
      'execGuardrail',
    )
    expect(overridden).toEqual({
      cwd: path.resolve('/base/sub/dir'),
      env: { A: '1', B: 'override', C: '3' },
    })
  })
})
