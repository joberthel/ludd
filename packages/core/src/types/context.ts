import type { ArtifactClient } from './artifact.js'

export type { ArtifactClient }

export type StepStatus = 'passed' | 'failed' | 'skipped'

export interface StepResult<TOutput = unknown> {
  status: StepStatus
  output?: TOutput
}

export interface MatrixCursor<TMatrixItem = unknown> {
  index: number
  total: number
  item: TMatrixItem
}

export interface StepContext<
  TCurrentOutput = unknown,
  TSteps extends Record<string, StepResult<any>> = Record<string, StepResult<any>>,
  TMatrixItem = unknown,
  THasMatrix extends boolean = false,
> {
  runId: string
  steps: TSteps
  step: {
    id: string
    output: TCurrentOutput
    attempt: number
  }
  matrix: THasMatrix extends true ? MatrixCursor<TMatrixItem> : MatrixCursor<TMatrixItem> | undefined
  artifacts: ArtifactClient
}

/** Context passed after this step's beforeStep guardrails have completed. */
export type StepContextWithBeforeStep<TContext, TBeforeStep> = TContext & { beforeStep: TBeforeStep }

/** Context passed after this step's initial interactive questions have been answered. */
export type StepContextWithInteractive<TContext, TInteractive> = TContext & { interactive: TInteractive }

export type DynamicProperty<T, TContext = StepContext>
  = | T
    | ((ctx: TContext) => T | Promise<T>)
