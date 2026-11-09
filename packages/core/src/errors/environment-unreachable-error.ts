export class EnvironmentUnreachableError extends Error {
  readonly envId: string
  readonly workingDir: string

  constructor(envId: string, workingDir: string, message?: string) {
    super(
      message
      ?? `Environment "${envId}" (workingDir: "${workingDir}") is unreachable. Health check ping failed during rehydration.`,
    )
    this.name = 'EnvironmentUnreachableError'
    this.envId = envId
    this.workingDir = workingDir
  }
}
