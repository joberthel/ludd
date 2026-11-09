import type {
  DynamicProperty,
  Guardrail,
  GuardrailExecutionInput,
  GuardrailVerdict,
  OnMaxRetriesExceededAction,
  ProvisionedEnvironment,
  StepContext,
} from '@ludd/core'

export interface FnGuardrailConfig<
  TBody = unknown,
  TContext extends StepContext<any, any, any, any> = StepContext,
> {
  maxRetries?: number
  onMaxRetriesExceeded?: OnMaxRetriesExceededAction
  environment?: DynamicProperty<ProvisionedEnvironment, TContext>
  run: (ctx: TContext) => GuardrailVerdict<TBody> | Promise<GuardrailVerdict<TBody>>
}

export type FnGuardrailInput<
  TBody = unknown,
  TContext extends StepContext<any, any, any, any> = StepContext,
>
  = | FnGuardrailConfig<TBody, TContext>
    | ((ctx: TContext) => GuardrailVerdict<TBody> | Promise<GuardrailVerdict<TBody>>)

function validateFnGuardrailConfig<TBody, TContext extends StepContext<any, any, any, any>>(
  config: FnGuardrailConfig<TBody, TContext>,
): void {
  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    throw new TypeError('fnGuardrail configuration must be a non-null object.')
  }
  if (typeof config.run !== 'function') {
    throw new TypeError('fnGuardrail "run" property must be a function.')
  }
  if (
    config.maxRetries !== undefined
    && (typeof config.maxRetries !== 'number'
      || !Number.isInteger(config.maxRetries)
      || config.maxRetries < 0)
  ) {
    throw new TypeError('fnGuardrail "maxRetries" must be a non-negative integer.')
  }
  if (
    config.onMaxRetriesExceeded !== undefined
    && config.onMaxRetriesExceeded !== 'abort'
    && config.onMaxRetriesExceeded !== 'prompt_user'
  ) {
    throw new TypeError(
      'fnGuardrail "onMaxRetriesExceeded" must be "abort" or "prompt_user".',
    )
  }
}

export function fnGuardrail<
  TBody = unknown,
  TContext extends StepContext<any, any, any, any> = StepContext,
>(
  input: FnGuardrailInput<TBody, TContext>,
): Guardrail<TBody, TContext> {
  const normalized = typeof input === 'function'
    ? { run: input }
    : input
  validateFnGuardrailConfig(normalized)

  return {
    __kind: 'guardrail',
    type: 'fn',
    maxRetries: normalized.maxRetries,
    onMaxRetriesExceeded: normalized.onMaxRetriesExceeded,
    environment: normalized.environment,
    execute: async (
      execInput: GuardrailExecutionInput<TContext>,
    ): Promise<GuardrailVerdict<TBody>> => {
      return normalized.run(execInput.ctx)
    },
  }
}
