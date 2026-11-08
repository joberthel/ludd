export type LedgerEventType
  = | 'run.started'
    | 'run.resumed'
    | 'run.passed'
    | 'run.failed'
    | 'step.started'
    | 'step.passed'
    | 'step.skipped'
    | 'step.failed'
    | 'agent.stream.linked'

export interface LedgerEvent<TPayload = Record<string, unknown>> {
  schemaVersion: 1
  timestamp: string
  runId: string
  stepId: string | null
  eventType: LedgerEventType
  payload: TPayload
}
