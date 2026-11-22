import type {
  DynamicProperty,
  Guardrail,
  GuardrailExecutionInput,
  GuardrailVerdict,
  StepContext,
} from '@luddjs/core'
import { resolveDynamicProperty } from '@luddjs/core'

export interface HumanReviewGuardrailConfig<
  TContext extends StepContext<any, any, any, any> = StepContext,
> {
  name?: string
  prompt: DynamicProperty<string, TContext>
  maxRetries?: number
}

export interface HumanReviewGuardrail<
  TContext extends StepContext<any, any, any, any> = StepContext,
> extends Guardrail<string, TContext> {
  readonly prompt: DynamicProperty<string, TContext>
  readonly maxRetries?: number
}

function validateHumanReviewConfig<TContext extends StepContext<any, any, any, any>>(
  config: unknown,
): asserts config is HumanReviewGuardrailConfig<TContext> {
  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    throw new TypeError('humanReviewGuardrail configuration must be a non-null object.')
  }
  const candidate = config as Record<string, unknown>
  if (candidate.name !== undefined && (typeof candidate.name !== 'string' || candidate.name.trim() === '')) {
    throw new TypeError('humanReviewGuardrail "name" must be a non-empty string.')
  }
  if (typeof candidate.prompt !== 'string' && typeof candidate.prompt !== 'function') {
    throw new TypeError('humanReviewGuardrail "prompt" must be a string or a function.')
  }
  if (
    candidate.maxRetries !== undefined
    && (typeof candidate.maxRetries !== 'number'
      || !Number.isInteger(candidate.maxRetries)
      || candidate.maxRetries < 0)
  ) {
    throw new TypeError('humanReviewGuardrail "maxRetries" must be a non-negative integer.')
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
    ...(config.name !== undefined
      ? { name: config.name }
      : {}),
    prompt: config.prompt,
    maxRetries: config.maxRetries,
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
