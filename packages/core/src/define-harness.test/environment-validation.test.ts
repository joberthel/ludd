import type { ProvisionedEnvironment } from '../types/environment.js'
import { describe, expect, it } from 'vitest'
import { validateHarnessConfig } from '../define-harness.js'
import { HarnessConfigError } from '../errors/harness-config-error.js'

const dummyEnv: ProvisionedEnvironment = {
  __kind: 'environment',
  id: 'env-1',
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

describe('validateHarnessConfig valid step environment', () => {
  it('accepts step with a valid static ProvisionedEnvironment', () => {
    const config = validateHarnessConfig({
      name: 'env-test',
      steps: [
        {
          id: 's1',
          environment: dummyEnv,
          run: () => {},
        },
      ],
    })
    expect(config.steps[0].environment).toBe(dummyEnv)
  })

  it('accepts step with a dynamic environment function', () => {
    const fn = () => dummyEnv
    const config = validateHarnessConfig({
      name: 'env-test',
      steps: [
        {
          id: 's1',
          environment: fn,
          run: () => {},
        },
      ],
    })
    expect(config.steps[0].environment).toBe(fn)
  })

  it('accepts step with a valid static EnvironmentAdapter', () => {
    const adapter = {
      __kind: 'environment-adapter' as const,
      id: 'adapter-1',
      type: 'git-worktree',
      provision: async () => dummyEnv,
    }
    const config = validateHarnessConfig({
      name: 'env-adapter-test',
      steps: [
        {
          id: 's1',
          environment: adapter,
          run: () => {},
        },
      ],
    })
    expect(config.steps[0].environment).toBe(adapter)
  })
})

describe('validateHarnessConfig invalid step environment', () => {
  it('rejects step with an invalid static environment object', () => {
    expect(() => validateHarnessConfig({
      name: 'env-test',
      steps: [
        {
          id: 's1',
          environment: { notAnEnv: true } as any,
          run: () => {},
        },
      ],
    })).toThrow(HarnessConfigError)

    expect(() => validateHarnessConfig({
      name: 'env-test',
      steps: [
        {
          id: 's1',
          environment: 'invalid' as any,
          run: () => {},
        },
      ],
    })).toThrow('Step "s1" "environment" must be a ProvisionedEnvironment or a function.')
  })
})
