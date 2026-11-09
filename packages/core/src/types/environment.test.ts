import type { EnvironmentAdapter, ProvisionedEnvironment } from './environment.js'
import { describe, expect, it } from 'vitest'
import { isEnvironmentAdapter, isProvisionedEnvironment } from './environment.js'

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
    expect(isProvisionedEnvironment({ ...validEnv, supportsDangerMode: true })).toBe(true)
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

describe('isEnvironmentAdapter type guard', () => {
  const validAdapter: EnvironmentAdapter = {
    __kind: 'environment-adapter',
    id: 'test-adapter',
    type: 'git-worktree',
    provision: async () => ({
      __kind: 'environment',
      id: 'test-adapter',
      type: 'git-worktree',
      workingDir: '/workspace/wt',
      exec: async () => ({
        exitCode: 0,
        stdout: '',
        stderr: '',
        timedOut: false,
      }),
      ping: async () => true,
      teardown: async () => {},
    }),
  }

  it('returns true for a fully compliant EnvironmentAdapter', () => {
    expect(isEnvironmentAdapter(validAdapter)).toBe(true)
    expect(isEnvironmentAdapter({ ...validAdapter, supportsDangerMode: true })).toBe(true)
  })

  it('returns false for non-objects or null', () => {
    expect(isEnvironmentAdapter(null)).toBe(false)
    expect(isEnvironmentAdapter(undefined)).toBe(false)
    expect(isEnvironmentAdapter('adapter')).toBe(false)
    expect(isEnvironmentAdapter(456)).toBe(false)
  })

  it('returns false when __kind is incorrect or missing', () => {
    expect(isEnvironmentAdapter({ ...validAdapter, __kind: 'environment' })).toBe(false)
    expect(isEnvironmentAdapter({ ...validAdapter, __kind: undefined })).toBe(false)
  })

  it('returns false when id is not a string', () => {
    expect(isEnvironmentAdapter({ ...validAdapter, id: 123 })).toBe(false)
  })

  it('returns false when type is not a string', () => {
    expect(isEnvironmentAdapter({ ...validAdapter, type: null })).toBe(false)
  })

  it('returns false when provision is not a function', () => {
    expect(isEnvironmentAdapter({ ...validAdapter, provision: 'not-a-func' })).toBe(false)
  })
})
