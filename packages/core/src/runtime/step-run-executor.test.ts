import type { StepContext } from '../types/context.js'
import type { StepConfig } from '../types/harness.js'
import type { RunStateSnapshot } from '../types/state.js'
import { describe, expect, it } from 'vitest'
import { GuardrailRetrySignal } from './guardrail-retry-signal.js'
import { executeStepRun } from './step-run-executor.js'

describe('executeStepRun function step retry', () => {
  it('re-runs function step when runAfterStepGuardrails throws GuardrailRetrySignal', async () => {
    let calls = 0
    const step: StepConfig = {
      id: 'fn-step',
      afterStep: () => {
        if (calls === 1) {
          throw new GuardrailRetrySignal('retry prompt')
        }
        return []
      },
      run: () => {
        calls += 1
        return { attempt: calls }
      },
    }

    const ctx = {
      step: { id: 'fn-step', output: undefined, attempt: 1 },
      artifacts: { dir: '/tmp/artifacts' },
    } as unknown as StepContext

    const snapshot = {
      runId: 'run-1',
      status: 'running',
      activeGate: null,
    } as unknown as RunStateSnapshot

    const result = await executeStepRun(step, {
      ctx,
      snapshot,
      runDir: '/tmp/run-1',
    }, '')

    expect(calls).toBe(2)
    expect(ctx.step.attempt).toBe(2)
    expect(result).toEqual({ attempt: 2 })
    expect(new GuardrailRetrySignal('msg')).toBeInstanceOf(Error)
  })
})
