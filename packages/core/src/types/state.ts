import type { StepResult } from './context.js'
import type { LogMetadata } from './log.js'

export type RunStatus = 'running' | 'passed' | 'failed'

export interface RunStateSnapshot {
  schemaVersion: 1
  runId: string
  harnessName: string
  status: RunStatus
  activeStepId: string | null
  activeSessionId?: string | null
  activeStepAttempt?: number
  activeMatrixIndex?: number | null
  activeMatrixOutputs?: unknown[]
  activeGuardrailRetries?: Record<string, number>
  steps: Record<string, StepResult<unknown>>
  artifacts?: string[]
  logs?: Record<string, LogMetadata>
  updatedAt: string // ISO-8601 timestamp
}
