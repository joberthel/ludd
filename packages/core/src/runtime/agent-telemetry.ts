import type { AgentAccessMode } from '../types/agent.js'
import type { StepContext } from '../types/context.js'
import { appendLedgerEvent } from '../persistence/ledger-writer.js'
import { appendStreamEvent } from '../persistence/stream-writer.js'

export function emitPreTurnEvents(
  runDir: string,
  ctx: StepContext,
  stepId: string,
  sessionId: string,
  prompt: string,
  mode: AgentAccessMode,
  attempt: number,
): void {
  appendLedgerEvent(runDir, {
    schemaVersion: 1,
    timestamp: new Date().toISOString(),
    runId: ctx.runId,
    stepId,
    matrixIndex: ctx.matrix?.index,
    eventType: 'agent.stream.linked',
    payload: { sessionId, streamPath: `streams/${sessionId}.jsonl`, attempt },
  })
  appendStreamEvent(runDir, sessionId, {
    schemaVersion: 1,
    timestamp: new Date().toISOString(),
    runId: ctx.runId,
    stepId,
    sessionId,
    attempt,
    eventType: 'turn.started',
    payload: { prompt, mode },
  })
}

export function emitTurnCompleted(
  runDir: string,
  ctx: StepContext,
  stepId: string,
  sessionId: string,
  output: unknown,
  attempt: number,
): void {
  appendStreamEvent(runDir, sessionId, {
    schemaVersion: 1,
    timestamp: new Date().toISOString(),
    runId: ctx.runId,
    stepId,
    sessionId,
    attempt,
    eventType: 'turn.completed',
    payload: { output },
  })
}
