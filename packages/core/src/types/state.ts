import type { StepResult } from './context.js'

export type RunStatus = 'running' | 'passed' | 'failed'

export interface RunStateSnapshot {
  schemaVersion: 1
  runId: string
  harnessName: string
  status: RunStatus
  activeStepId: string | null
  steps: Record<string, StepResult<unknown>>
  updatedAt: string // ISO-8601 timestamp
}
