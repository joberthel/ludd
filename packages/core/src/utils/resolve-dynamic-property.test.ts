import type { ArtifactClient, StepContext } from '../types/context.js'
import { describe, expect, it } from 'vitest'
import { resolveDynamicProperty } from './resolve-dynamic-property.js'

function createMockContext(): StepContext {
  return {
    runId: 'run-123',
    environments: {
      default: {
        __kind: 'environment',
        id: 'default',
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
      },
    },
    steps: {
      build: {
        status: 'passed',
        output: { success: true },
      },
    },
    step: {
      id: 'test-step',
      output: null,
      attempt: 1,
    },
    matrix: undefined,
    artifacts: {} as ArtifactClient,
  }
}

describe('resolveDynamicProperty with static primitive values', () => {
  it('returns string unchanged', async () => {
    const ctx = createMockContext()
    await expect(resolveDynamicProperty('ludd', ctx)).resolves.toBe('ludd')
  })

  it('returns number unchanged', async () => {
    const ctx = createMockContext()
    await expect(resolveDynamicProperty(42, ctx)).resolves.toBe(42)
  })

  it('returns boolean unchanged', async () => {
    const ctx = createMockContext()
    await expect(resolveDynamicProperty(true, ctx)).resolves.toBe(true)
    await expect(resolveDynamicProperty(false, ctx)).resolves.toBe(false)
  })

  it('returns undefined and null unchanged', async () => {
    const ctx = createMockContext()
    await expect(resolveDynamicProperty(undefined, ctx)).resolves.toBeUndefined()
    await expect(resolveDynamicProperty(null, ctx)).resolves.toBeNull()
  })
})

describe('resolveDynamicProperty with static non-primitive values', () => {
  it('returns objects unchanged by reference', async () => {
    const ctx = createMockContext()
    const obj = {
      key: 'value',
      nested: { num: 1 },
    }
    await expect(resolveDynamicProperty(obj, ctx)).resolves.toBe(obj)
  })

  it('returns arrays unchanged by reference', async () => {
    const ctx = createMockContext()
    const arr = [
      1,
      'two',
      { three: 3 },
    ]
    await expect(resolveDynamicProperty(arr, ctx)).resolves.toBe(arr)
  })
})

describe('resolveDynamicProperty with callback functions', () => {
  it('resolves synchronous callback with context', async () => {
    const ctx = createMockContext()
    const result = await resolveDynamicProperty(
      c => `step-${c.step.id}-${c.runId}`,
      ctx,
    )
    expect(result).toBe('step-test-step-run-123')
  })

  it('resolves asynchronous callback with context', async () => {
    const ctx = createMockContext()
    const result = await resolveDynamicProperty(
      async c => Promise.resolve(`async-${c.step.attempt}`),
      ctx,
    )
    expect(result).toBe('async-1')
  })

  it('supports custom context generic argument', async () => {
    const customCtx = { customField: 'hello-world' }
    const result = await resolveDynamicProperty(
      (c: typeof customCtx) => c.customField.toUpperCase(),
      customCtx,
    )
    expect(result).toBe('HELLO-WORLD')
  })

  it('accesses typed matrix cursor when present', async () => {
    const ctx: StepContext<unknown, Record<string, never>, string> = {
      ...createMockContext(),
      steps: {},
      matrix: { index: 0, total: 3, item: 'matrix-slice' },
    }
    const result = await resolveDynamicProperty(
      c => c.matrix?.item,
      ctx,
    )
    expect(result).toBe('matrix-slice')
  })
})

describe('resolveDynamicProperty error propagation', () => {
  it('propagates synchronous callback error', async () => {
    const ctx = createMockContext()
    await expect(
      resolveDynamicProperty(() => {
        throw new Error('sync failure')
      }, ctx),
    ).rejects.toThrow('sync failure')
  })

  it('propagates asynchronous callback rejection', async () => {
    const ctx = createMockContext()
    await expect(
      resolveDynamicProperty(async () => {
        throw new Error('async failure')
      }, ctx),
    ).rejects.toThrow('async failure')
  })
})
