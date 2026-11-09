import type { AgentRunner, ProvisionedEnvironment } from '@ludd/core'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { agentGuardrail } from '../agent-guardrail.js'

const dummyEnv: ProvisionedEnvironment = {
  __kind: 'environment',
  id: 'dummy-env',
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

const dummyAgent: AgentRunner<any, any> = {
  __kind: 'agent',
  mode: 'read-only',
  prompt: 'default-prompt',
  executeTurn: async () => ({
    output: { status: 'pass' },
    sessionId: 's-1',
  }),
}

describe('agentGuardrail validation: object and agent', () => {
  it('rejects non-object or null configs', () => {
    expect(() => agentGuardrail(null as any)).toThrow(
      new TypeError('agentGuardrail configuration must be a non-null object.'),
    )
    expect(() => agentGuardrail([] as any)).toThrow(
      new TypeError('agentGuardrail configuration must be a non-null object.'),
    )
    expect(() => agentGuardrail('not an object' as any)).toThrow(
      new TypeError('agentGuardrail configuration must be a non-null object.'),
    )
  })

  it('rejects invalid agent runners', () => {
    expect(() => agentGuardrail({ agent: null, prompt: 'hello' } as any)).toThrow(
      new TypeError('agentGuardrail "agent" must be a valid AgentRunner.'),
    )
    expect(() => agentGuardrail({ agent: {}, prompt: 'hello' } as any)).toThrow(
      new TypeError('agentGuardrail "agent" must be a valid AgentRunner.'),
    )
    expect(() =>
      agentGuardrail({
        agent: {
          __kind: 'not-agent',
          mode: 'read-only',
          prompt: 'p',
          executeTurn: () => {},
        },
        prompt: 'hello',
      } as any),
    ).toThrow(new TypeError('agentGuardrail "agent" must be a valid AgentRunner.'))
  })
})

describe('agentGuardrail validation: prompt', () => {
  it('rejects invalid prompts', () => {
    expect(() => agentGuardrail({ agent: dummyAgent, prompt: '' } as any)).toThrow(
      new TypeError('agentGuardrail "prompt" must be a non-empty string or function.'),
    )
    expect(() => agentGuardrail({ agent: dummyAgent, prompt: '   ' } as any)).toThrow(
      new TypeError('agentGuardrail "prompt" must be a non-empty string or function.'),
    )
    expect(() => agentGuardrail({ agent: dummyAgent, prompt: 123 } as any)).toThrow(
      new TypeError('agentGuardrail "prompt" must be a non-empty string or function.'),
    )
  })

  it('accepts valid prompts', () => {
    const railString = agentGuardrail({ agent: dummyAgent, prompt: 'Review code' })
    expect(railString.type).toBe('agent')

    const railFn = agentGuardrail({
      agent: dummyAgent,
      prompt: () => 'Review code',
    })
    expect(railFn.type).toBe('agent')
  })
})

describe('agentGuardrail validation: mode and bodySchema', () => {
  it('validates mode', () => {
    expect(() =>
      agentGuardrail({ agent: dummyAgent, prompt: 'p', mode: 'invalid' as any }),
    ).toThrow(new TypeError('agentGuardrail "mode" must be "read-only" or "workspace-write".'))

    const roRail = agentGuardrail({ agent: dummyAgent, prompt: 'p', mode: 'read-only' })
    expect(roRail.type).toBe('agent')

    const wwRail = agentGuardrail({ agent: dummyAgent, prompt: 'p', mode: 'workspace-write' })
    expect(wwRail.type).toBe('agent')
  })

  it('validates bodySchema', () => {
    expect(() =>
      agentGuardrail({ agent: dummyAgent, prompt: 'p', bodySchema: 'not a schema' as any }),
    ).toThrow(new TypeError('agentGuardrail "bodySchema" must be a valid Zod schema.'))

    expect(() =>
      agentGuardrail({ agent: dummyAgent, prompt: 'p', bodySchema: {} as any }),
    ).toThrow(new TypeError('agentGuardrail "bodySchema" must be a valid Zod schema.'))

    const validRail = agentGuardrail({
      agent: dummyAgent,
      prompt: 'p',
      bodySchema: z.object({
        findings: z.array(z.string()),
      }),
    })
    expect(validRail.type).toBe('agent')
  })
})

describe('agentGuardrail validation: retries', () => {
  it('validates maxRetries', () => {
    expect(() =>
      agentGuardrail({ agent: dummyAgent, prompt: 'p', maxRetries: -1 }),
    ).toThrow(new TypeError('agentGuardrail "maxRetries" must be a non-negative integer.'))

    expect(() =>
      agentGuardrail({ agent: dummyAgent, prompt: 'p', maxRetries: 1.5 }),
    ).toThrow(new TypeError('agentGuardrail "maxRetries" must be a non-negative integer.'))

    expect(() =>
      agentGuardrail({ agent: dummyAgent, prompt: 'p', maxRetries: '2' as any }),
    ).toThrow(new TypeError('agentGuardrail "maxRetries" must be a non-negative integer.'))

    const valid = agentGuardrail({ agent: dummyAgent, prompt: 'p', maxRetries: 3 })
    expect(valid.maxRetries).toBe(3)
  })

  it('validates onMaxRetriesExceeded', () => {
    expect(() =>
      agentGuardrail({ agent: dummyAgent, prompt: 'p', onMaxRetriesExceeded: 'invalid' as any }),
    ).toThrow(new TypeError('agentGuardrail "onMaxRetriesExceeded" must be "abort" or "prompt_user".'))

    const abortRail = agentGuardrail({ agent: dummyAgent, prompt: 'p', onMaxRetriesExceeded: 'abort' })
    expect(abortRail.onMaxRetriesExceeded).toBe('abort')

    const promptRail = agentGuardrail({ agent: dummyAgent, prompt: 'p', onMaxRetriesExceeded: 'prompt_user' })
    expect(promptRail.onMaxRetriesExceeded).toBe('prompt_user')
  })
})

describe('agentGuardrail validation: pagination and properties', () => {
  it('validates pagination', () => {
    const errorMsg = 'agentGuardrail "pagination" must be a non-empty string, an object with a "key" string property, or a selector function.'
    expect(() => agentGuardrail({ agent: dummyAgent, prompt: 'p', pagination: '' })).toThrow(new TypeError(errorMsg))
    expect(() => agentGuardrail({ agent: dummyAgent, prompt: 'p', pagination: '   ' })).toThrow(new TypeError(errorMsg))
    expect(() => agentGuardrail({
      agent: dummyAgent,
      prompt: 'p',
      pagination: { key: '' } as any,
    })).toThrow(new TypeError(errorMsg))
    expect(() => agentGuardrail({ agent: dummyAgent, prompt: 'p', pagination: {} as any })).toThrow(new TypeError(errorMsg))
    expect(() => agentGuardrail({ agent: dummyAgent, prompt: 'p', pagination: 123 as any })).toThrow(new TypeError(errorMsg))

    expect(agentGuardrail({ agent: dummyAgent, prompt: 'p', pagination: 'items' }).type).toBe('agent')
    expect(agentGuardrail({
      agent: dummyAgent,
      prompt: 'p',
      pagination: { key: 'items' },
    }).type).toBe('agent')
    expect(agentGuardrail({
      agent: dummyAgent,
      prompt: 'p',
      pagination: () => [],
    }).type).toBe('agent')
  })

  it('preserves environment and configuration properties', () => {
    const rail = agentGuardrail({
      agent: dummyAgent,
      prompt: 'Check environment',
      environment: dummyEnv,
      maxRetries: 2,
      onMaxRetriesExceeded: 'abort',
    })

    expect(rail.__kind).toBe('guardrail')
    expect(rail.type).toBe('agent')
    expect(rail.maxRetries).toBe(2)
    expect(rail.onMaxRetriesExceeded).toBe('abort')
    expect(rail.environment).toBe(dummyEnv)
  })
})
