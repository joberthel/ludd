export class SandboxViolationError extends Error {
  readonly targetPath: string
  readonly reason: string

  constructor(targetPath: string, reason: string = 'Path access is not permitted by the sandbox') {
    super(`Sandbox violation for "${targetPath}": ${reason}.`)
    this.name = 'SandboxViolationError'
    this.targetPath = targetPath
    this.reason = reason
  }
}
