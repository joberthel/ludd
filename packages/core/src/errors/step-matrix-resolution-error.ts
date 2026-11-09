export class StepMatrixResolutionError extends Error {
  readonly stepId: string
  readonly reason: string

  constructor(stepId: string, reason: string) {
    super(`Step "${stepId}" matrix resolution failed: ${reason}`)
    this.name = 'StepMatrixResolutionError'
    this.stepId = stepId
    this.reason = reason
  }
}
