export class RunAlreadyExistsError extends Error {
  readonly runId: string

  constructor(runId: string) {
    super(`Run "${runId}" already exists. Use "ludd resume ${runId}" to resume it.`)
    this.name = 'RunAlreadyExistsError'
    this.runId = runId
  }
}
