export class ForbiddenMountPathError extends Error {
  readonly hostPath: string
  readonly reason: string

  constructor(hostPath: string, reason: string = 'Mount path is inside a forbidden directory') {
    super(`Forbidden mount path "${hostPath}": ${reason}.`)
    this.name = 'ForbiddenMountPathError'
    this.hostPath = hostPath
    this.reason = reason
  }
}
