import type { DynamicProperty, StepContext } from '../types/context.js'

export type { DynamicProperty }

export async function resolveDynamicProperty<T, TContext = StepContext>(
  prop: DynamicProperty<T, TContext>,
  ctx: TContext,
): Promise<T> {
  if (typeof prop === 'function') {
    return (prop as (context: TContext) => T | Promise<T>)(ctx)
  }
  return prop
}
