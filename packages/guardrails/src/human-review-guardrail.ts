import type {
  DynamicProperty,
  Guardrail,
  GuardrailExecutionInput,
  GuardrailVerdict,
  StepContext,
} from '@ludd/core'
import { resolveDynamicProperty } from '@ludd/core'

export interface HumanReviewGuardrailConfig<
  TContext extends StepContext<any, any, any, any> = StepContext,
> {
  prompt: DynamicProperty<string, TContext>
}

export interface HumanReviewGuardrail<
  TContext extends StepContext<any, any, any, any> = StepContext,
> extends Guardrail<string, TContext> {
  readonly prompt: DynamicProperty<string, TContext>
}

function validateHumanReviewConfig<TContext extends StepContext<any, any, any, any>>(
  config: unknown,
): asserts config is HumanReviewGuardrailConfig<TContext> {
  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    throw new TypeError('humanReviewGuardrail configuration must be a non-null object.')
  }
  const candidate = config as Record<string, unknown>
  if (typeof candidate.prompt !== 'string' && typeof candidate.prompt !== 'function') {
    throw new TypeError('humanReviewGuardrail "prompt" must be a string or a function.')
  }
}

export function humanReviewGuardrail<
  TContext extends StepContext<any, any, any, any> = StepContext,
>(
  config: HumanReviewGuardrailConfig<TContext>,
): HumanReviewGuardrail<TContext> {
  validateHumanReviewConfig<TContext>(config)

  return {
    __kind: 'guardrail',
    type: 'human_review',
    prompt: config.prompt,
    execute: async (
      execInput: GuardrailExecutionInput<TContext>,
    ): Promise<GuardrailVerdict<string>> => {
      const resolved = await resolveDynamicProperty(config.prompt, execInput.ctx)
      return {
        status: 'pass',
        body: resolved,
      }
    },
  }
}
