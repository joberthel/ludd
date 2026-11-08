export const DEFAULT_MAX_TOTAL_TURNS = 15

export class MaxTotalTurnsExceededError extends Error {
  readonly stepId: string
  readonly maxTotalTurns: number
  readonly lastError?: unknown

  constructor(stepId: string, maxTotalTurns: number, lastError?: unknown) {
    const errorDetails = lastError instanceof Error
      ? `: ${lastError.message}`
      : ''
    super(`Step "${stepId}" exceeded maximum total turns (${maxTotalTurns})${errorDetails}.`)
    this.name = 'MaxTotalTurnsExceededError'
    this.stepId = stepId
    this.maxTotalTurns = maxTotalTurns
    this.lastError = lastError
  }
}
