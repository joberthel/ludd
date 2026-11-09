export type LedgerEventType
  = | 'run.started'
    | 'run.resumed'
    | 'run.passed'
    | 'run.failed'
    | 'run.teardown'
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
    | 'gate.waiting'
    | 'gate.resolved'

export interface LedgerEvent<TPayload = Record<string, unknown>> {
  schemaVersion: 1
  timestamp: string
  runId: string
  stepId: string | null
  matrixIndex?: number
  eventType: LedgerEventType
  payload: TPayload
}
