import type { StepContext } from './context.js'

export type InteractiveSelectOption = string | {
  readonly label: string
  readonly value: string
}

export interface InteractiveTextQuestion {
  readonly type: 'text'
  readonly prompt: string
  readonly default?: string
  readonly placeholder?: string
}

export interface InteractiveNumberQuestion {
  readonly type: 'number'
  readonly prompt: string
  readonly min?: number
  readonly max?: number
  readonly default?: number
}

export interface InteractiveSelectQuestion<TOption extends InteractiveSelectOption = InteractiveSelectOption> {
  readonly type: 'select'
  readonly prompt: string
  readonly options: readonly TOption[]
  readonly default?: string
  readonly allowOther?: boolean
}

export interface InteractiveMultiSelectQuestion<TOption extends InteractiveSelectOption = InteractiveSelectOption> {
  readonly type: 'multi-select'
  readonly prompt: string
  readonly options: readonly TOption[]
  readonly default?: readonly string[]
}

export interface InteractiveConfirmQuestion {
  readonly type: 'confirm'
  readonly prompt: string
  readonly default?: boolean
}

export type InteractiveQuestion
  = | InteractiveTextQuestion
    | InteractiveNumberQuestion
    | InteractiveSelectQuestion
    | InteractiveMultiSelectQuestion
    | InteractiveConfirmQuestion

export type InteractiveQuestionMap = Readonly<Record<string, InteractiveQuestion>>

type ExtractOptionValue<TOption>
  = TOption extends { readonly value: infer TValue extends string }
    ? TValue
    : TOption extends string
      ? TOption
      : string

export type InferQuestionAnswer<TQuestion>
  = TQuestion extends { readonly type: 'text' }
    ? string
    : TQuestion extends { readonly type: 'number' }
      ? number
      : TQuestion extends { readonly type: 'confirm' }
        ? boolean
        : TQuestion extends { readonly type: 'select', readonly allowOther: true }
          ? string
          : TQuestion extends { readonly type: 'select', readonly options: readonly (infer TOption)[] }
            ? ExtractOptionValue<TOption>
            : TQuestion extends { readonly type: 'multi-select', readonly options: readonly (infer TOption)[] }
              ? ExtractOptionValue<TOption>[]
              : unknown

export type InteractiveInitialQuestions<TContext extends StepContext<any, any, any, any> = StepContext>
  = | InteractiveQuestionMap
    | ((ctx: TContext) => InteractiveQuestionMap | Promise<InteractiveQuestionMap>)

export interface InteractiveStepOptions<
  TContext extends StepContext<any, any, any, any> = StepContext,
  TQuestions extends InteractiveInitialQuestions<TContext> = InteractiveInitialQuestions<TContext>,
> {
  readonly initialQuestions?: TQuestions
  readonly maxQuestions?: number
}

export type StepInteractiveConfig<
  TContext extends StepContext<any, any, any, any> = StepContext,
  TQuestions extends InteractiveInitialQuestions<TContext> = InteractiveInitialQuestions<TContext>,
> = boolean | InteractiveStepOptions<TContext, TQuestions>

type InferQuestionMapAnswers<TMap> = TMap extends (...args: any[]) => infer TReturn
  ? InferQuestionMapAnswers<Awaited<TReturn>>
  : TMap extends Record<string, unknown>
    ? { [K in keyof TMap]: InferQuestionAnswer<TMap[K]> }
    : Record<string, never>

export type InteractiveAnswers<TInteractive>
  = TInteractive extends { readonly initialQuestions?: infer TQuestions }
    ? [NonNullable<TQuestions>] extends [never]
        ? Record<string, never>
        : InferQuestionMapAnswers<NonNullable<TQuestions>>
    : Record<string, never>

export function normalizeSelectOptions(
  options: readonly InteractiveSelectOption[],
): Array<{ label: string, value: string }> {
  return options.map(opt => typeof opt === 'string'
    ? { label: opt, value: opt }
    : { label: opt.label, value: opt.value })
}
