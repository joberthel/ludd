import type { StepContext } from './context.js'

export interface EnvironmentExecOptions {
  cwd?: string
  env?: Record<string, string>
  timeoutMs?: number
  signal?: AbortSignal
  inheritEnv?: boolean
  dangerMode?: boolean
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
  readonly containerWorkingDir?: string
  readonly supportsDangerMode?: boolean
  readonly branchName?: string
  readonly containerId?: string
  readonly ephemeralPorts?: Record<string, number>
  readonly injectedEnv?: Record<string, string>
  exec: (command: string | readonly string[], options?: EnvironmentExecOptions) => Promise<EnvironmentExecResult>
  ping: () => Promise<boolean>
  teardown: () => Promise<void>
}

export interface ProvisionContext {
  runId: string
  workspaceDir: string
  defaultSignal?: AbortSignal
  ctx?: StepContext
}

export interface EnvironmentAdapter {
  readonly __kind: 'environment-adapter'
  readonly id: string
  readonly type: string
  readonly supportsDangerMode?: boolean
  provision: (context: ProvisionContext) => Promise<ProvisionedEnvironment>
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

export function isEnvironmentAdapter(value: unknown): value is EnvironmentAdapter {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const candidate = value as Record<string, unknown>
  return candidate.__kind === 'environment-adapter'
    && typeof candidate.id === 'string'
    && typeof candidate.type === 'string'
    && typeof candidate.provision === 'function'
}
