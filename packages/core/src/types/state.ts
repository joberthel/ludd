import type { StepResult } from './context.js'
import type { LogMetadata } from './log.js'

export type RunStatus = 'running' | 'waiting_for_gate' | 'passed' | 'failed'

export interface ActiveGateState {
  stepId: string
  matrixIndex?: number
  phase: 'beforeStep' | 'afterStep'
  guardrailIndex: number
  gateType: 'human_review' | 'max_retries_exceeded'
  prompt: string
  createdAt: string
}

export interface EnvironmentDescriptor {
  id: string
  type: string
  workingDir: string
}

export interface RunStateSnapshot {
  schemaVersion: 1
  runId: string
  harnessName: string
  status: RunStatus
  activeStepId: string | null
  activeGate?: ActiveGateState | null
  activeStepOutput?: unknown
  activeSessionId?: string | null
  activeStepAttempt?: number
  activeMatrixIndex?: number | null
  activeMatrixOutputs?: unknown[]
  activeGuardrailRetries?: Record<string, number>
  grantedExtraRetries?: Record<string, number>
  grantedExtraTurns?: Record<string, number>
  environments?: Record<string, EnvironmentDescriptor>
  steps: Record<string, StepResult<unknown>>
  artifacts?: string[]
  logs?: Record<string, LogMetadata>
  updatedAt: string // ISO-8601 timestamp
}
