export type LedgerEventType
  = | 'run.started'
    | 'run.resumed'
    | 'run.passed'
    | 'run.failed'
    | 'step.started'
    | 'step.passed'
    | 'step.skipped'
    | 'step.failed'
    | 'step.retry'
    | 'agent.stream.linked'
    | 'guardrail.started'
    | 'guardrail.passed'
    | 'guardrail.skipped'
    | 'guardrail.failed'

export interface LedgerEvent<TPayload = Record<string, unknown>> {
  schemaVersion: 1
  timestamp: string
  runId: string
  stepId: string | null
  matrixIndex?: number
  eventType: LedgerEventType
  payload: TPayload
}
