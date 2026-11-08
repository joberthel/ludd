export type StepStatus = 'passed' | 'failed' | 'skipped'

export interface StepResult<TOutput = unknown> {
  status: StepStatus
  output?: TOutput
}

export interface ProvisionedEnvironment {
  id: string
  [key: string]: unknown
}

export type ArtifactClient = Record<string, unknown>

export interface MatrixCursor<TMatrixItem = unknown> {
  index: number
  total: number
  item: TMatrixItem
}

export interface StepContext<
  TCurrentOutput = unknown,
  TSteps extends Record<string, StepResult<any>> = Record<string, StepResult<any>>,
  TMatrixItem = unknown,
> {
  runId: string
  environments: Record<string, ProvisionedEnvironment>
  steps: TSteps
  step: {
    id: string
    output: TCurrentOutput
    attempt: number
  }
  matrix: MatrixCursor<TMatrixItem> | undefined
  artifacts: ArtifactClient
}

export type DynamicProperty<T, TContext = StepContext>
  = | T
    | ((ctx: TContext) => T | Promise<T>)
