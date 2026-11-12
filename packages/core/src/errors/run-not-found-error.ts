export class RunNotFoundError extends Error {
  readonly runId: string

  constructor(runId: string) {
    super(`Run "${runId}" was not found.`)
    this.name = 'RunNotFoundError'
    this.runId = runId
  }
}
