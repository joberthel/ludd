function formatDefaultMessage(runId: string, pid: number): string {
  return `Run "${runId}" is already active with process PID ${pid}.`
}

export class RunAlreadyActiveError extends Error {
  readonly runId: string
  readonly pid: number

  constructor(runId: string, pid: number, message?: string) {
    super(message ?? formatDefaultMessage(runId, pid))
    this.name = 'RunAlreadyActiveError'
    this.runId = runId
    this.pid = pid
  }
}
