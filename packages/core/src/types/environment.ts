export interface EnvironmentExecOptions {
  cwd?: string
  env?: Record<string, string>
  timeoutMs?: number
}

export interface EnvironmentExecResult {
  exitCode: number | null
  stdout: string
  stderr: string
  timedOut: boolean
}

export interface ProvisionedEnvironment {
  readonly __kind: 'environment'
  readonly id: string
  readonly type: string
  readonly workingDir: string
  exec: (command: string | readonly string[], options?: EnvironmentExecOptions) => Promise<EnvironmentExecResult>
  ping: () => Promise<boolean>
  teardown: () => Promise<void>
}

export function isProvisionedEnvironment(value: unknown): value is ProvisionedEnvironment {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const candidate = value as Record<string, unknown>
  return candidate.__kind === 'environment'
    && typeof candidate.id === 'string'
    && typeof candidate.type === 'string'
    && typeof candidate.workingDir === 'string'
    && typeof candidate.exec === 'function'
    && typeof candidate.ping === 'function'
    && typeof candidate.teardown === 'function'
}
