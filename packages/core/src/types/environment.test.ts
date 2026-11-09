import type { ProvisionedEnvironment } from './environment.js'
import { describe, expect, it } from 'vitest'
import { isProvisionedEnvironment } from './environment.js'

describe('isProvisionedEnvironment type guard', () => {
  const validEnv: ProvisionedEnvironment = {
    __kind: 'environment',
    id: 'test-env',
    type: 'host',
    workingDir: '/workspace',
    exec: async () => ({
      exitCode: 0,
      stdout: '',
      stderr: '',
      timedOut: false,
    }),
    ping: async () => true,
    teardown: async () => {},
  }

  it('returns true for a fully compliant ProvisionedEnvironment', () => {
    expect(isProvisionedEnvironment(validEnv)).toBe(true)
  })

  it('returns false for non-objects or null', () => {
    expect(isProvisionedEnvironment(null)).toBe(false)
    expect(isProvisionedEnvironment(undefined)).toBe(false)
    expect(isProvisionedEnvironment('environment')).toBe(false)
    expect(isProvisionedEnvironment(123)).toBe(false)
  })

  it('returns false when __kind is incorrect or missing', () => {
    expect(isProvisionedEnvironment({ ...validEnv, __kind: 'other' })).toBe(false)
    expect(isProvisionedEnvironment({ ...validEnv, __kind: undefined })).toBe(false)
  })

  it('returns false when id is not a string', () => {
    expect(isProvisionedEnvironment({ ...validEnv, id: 123 })).toBe(false)
  })

  it('returns false when type is not a string', () => {
    expect(isProvisionedEnvironment({ ...validEnv, type: null })).toBe(false)
  })

  it('returns false when workingDir is not a string', () => {
    expect(isProvisionedEnvironment({ ...validEnv, workingDir: false })).toBe(false)
  })

  it('returns false when exec is not a function', () => {
    expect(isProvisionedEnvironment({ ...validEnv, exec: 'not-a-func' })).toBe(false)
  })

  it('returns false when ping is not a function', () => {
    expect(isProvisionedEnvironment({ ...validEnv, ping: null })).toBe(false)
  })

  it('returns false when teardown is not a function', () => {
    expect(isProvisionedEnvironment({ ...validEnv, teardown: undefined })).toBe(false)
  })
})
