import type { ArtifactClient } from './artifact.js'

export type { ArtifactClient }

export type StepStatus = 'passed' | 'failed' | 'skipped'

export interface StepResult<TOutput = unknown> {
  status: StepStatus
  output?: TOutput
}

export interface ProvisionedEnvironment {
  id: string
  [key: string]: unknown
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
  environments: Record<string, ProvisionedEnvironment>
  steps: TSteps
  step: {
    id: string
    output: TCurrentOutput
    attempt: number
  }
  matrix: THasMatrix extends true ? MatrixCursor<TMatrixItem> : MatrixCursor<TMatrixItem> | undefined
  artifacts: ArtifactClient
}

export type DynamicProperty<T, TContext = StepContext>
  = | T
    | ((ctx: TContext) => T | Promise<T>)
