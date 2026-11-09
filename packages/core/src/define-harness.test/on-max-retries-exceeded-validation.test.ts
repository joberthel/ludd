import { describe, expect, it } from 'vitest'
import { validateHarnessConfig } from '../define-harness.js'
import { HarnessConfigError } from '../errors/harness-config-error.js'

describe('validateHarnessConfig onMaxRetriesExceeded valid values', () => {
  it('accepts step with onMaxRetriesExceeded: "abort"', () => {
    expect(() => validateHarnessConfig({
      name: 'test',
      steps: [
        {
          id: 'step-1',
          onMaxRetriesExceeded: 'abort',
          run: () => {},
        },
      ],
    })).not.toThrow()
  })

  it('accepts step with onMaxRetriesExceeded: "prompt_user"', () => {
    expect(() => validateHarnessConfig({
      name: 'test',
      steps: [
        {
          id: 'step-1',
          onMaxRetriesExceeded: 'prompt_user',
          run: () => {},
        },
      ],
    })).not.toThrow()
  })

  it('accepts step without onMaxRetriesExceeded', () => {
    expect(() => validateHarnessConfig({
      name: 'test',
      steps: [
        {
          id: 'step-1',
          run: () => {},
        },
      ],
    })).not.toThrow()
  })
})

describe('validateHarnessConfig onMaxRetriesExceeded invalid values', () => {
  it('rejects step with unsupported string value', () => {
    expect(() => validateHarnessConfig({
      name: 'test',
      steps: [
        {
          id: 'step-1',
          onMaxRetriesExceeded: 'invalid' as any,
          run: () => {},
        },
      ],
    })).toThrow(HarnessConfigError)

    expect(() => validateHarnessConfig({
      name: 'test',
      steps: [
        {
          id: 'step-1',
          onMaxRetriesExceeded: 'invalid' as any,
          run: () => {},
        },
      ],
    })).toThrow('Step "step-1" "onMaxRetriesExceeded" must be "abort" or "prompt_user", received invalid.')
  })

  it('rejects step with non-string values', () => {
    expect(() => validateHarnessConfig({
      name: 'test',
      steps: [
        {
          id: 'step-1',
          onMaxRetriesExceeded: 123 as any,
          run: () => {},
        },
      ],
    })).toThrow('Step "step-1" "onMaxRetriesExceeded" must be "abort" or "prompt_user", received 123.')

    expect(() => validateHarnessConfig({
      name: 'test',
      steps: [
        {
          id: 'step-1',
          onMaxRetriesExceeded: {} as any,
          run: () => {},
        },
      ],
    })).toThrow('Step "step-1" "onMaxRetriesExceeded" must be "abort" or "prompt_user", received [object Object].')
  })
})
