export class UnsafeDangerModeError extends Error {
  readonly stepId: string
  readonly environmentType: string

  constructor(stepId: string, environmentType: string, message?: string) {
    super(
      message
      ?? `Step "${stepId}" requested dangerMode, but environment "${environmentType}" does not support it (dangerMode is restricted to containerized/VM environments).`,
    )
    this.name = 'UnsafeDangerModeError'
    this.stepId = stepId
    this.environmentType = environmentType
  }
}
