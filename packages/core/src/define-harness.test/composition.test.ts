import type { AgentRunner, StepConfig } from '../types/harness.js'
import { describe, expect, it } from 'vitest'
import { defineHarness } from '../define-harness.js'

describe('defineHarness composition and execution models', () => {
  it('validates and returns strong configuration with AgentRunner and cleanupPolicy', () => {
    const agent: AgentRunner<string> = {
      __kind: 'agent',
      mode: 'read-only',
      prompt: 'execute task',
      executeTurn: async () => ({ output: 'agent-result', sessionId: 's-1' }),
    }
    const harness = defineHarness({
      name: 'pipeline',
      cleanupPolicy: { onSuccess: 'keep', onFailure: 'destroy' },
      steps: [
        { id: 'step-agent', run: agent },
      ],
    })
    expect(harness.name).toBe('pipeline')
    expect(harness.cleanupPolicy?.onSuccess).toBe('keep')
    expect(harness.cleanupPolicy?.onFailure).toBe('destroy')
    expect(harness.steps).toHaveLength(1)
  })

  it('composes reusable step arrays via spread syntax', () => {
    function createCommonSteps(): StepConfig[] {
      return [
        {
          id: 'setup',
          run: () => 'ok',
        },
      ]
    }
    const harness = defineHarness({
      name: 'composed-harness',
      steps: [
        ...createCommonSteps(),
        {
          id: 'custom',
          run: () => 'custom',
        },
      ],
    })
    expect(harness.steps).toHaveLength(2)
    expect(harness.steps[0].id).toBe('setup')
    expect(harness.steps[1].id).toBe('custom')
  })
})
