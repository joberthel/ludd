import type { HarnessRunResult } from '../src/index.js'
import type { Epic6TestState } from './epic-06-steps.js'
import { expect } from 'vitest'
import { readLedgerEvents, readRunState } from '../src/index.js'

export function verifyEpic6Assertions(
  result: HarnessRunResult,
  runDir: string,
  state: Epic6TestState,
): void {
  expect(result.status).toBe('passed')
  expect(result.steps['triage-and-grilling']?.status).toBe('passed')
  expect(result.steps['generate-spec-and-todos']?.status).toBe('passed')
  expect(result.steps['implement-slices']?.status).toBe('passed')

  // AC 3.1 & 6.2: Session reuse across turns
  expect(state.triageSessions.length).toBe(2)
  expect(state.triageSessions[0]).toBe(state.triageSessions[1])
  expect(state.triagePrompts[1]).toContain('Use jose library and 15m expiration')

  // AC 6.7.1: Mid-gate crash rehydration skipped agent re-execution
  expect(state.specCallCount).toBe(1)

  // AC 6.5: Escalation gate retry
  expect(state.implementSessions.length).toBe(2)
  expect(state.implementSessions[0]).toBe(state.implementSessions[1])
  expect(state.implementPrompts[1]).toContain('Fix assertion')

  // Final persistence and ledger checks
  const finalState = readRunState(runDir)
  expect(finalState.status).toBe('passed')
  expect(finalState.activeGate).toBeNull()

  const events = readLedgerEvents(runDir)
  const eventTypes = events.map(e => e.eventType)
  expect(eventTypes).toContain('gate.waiting')
  expect(eventTypes).toContain('gate.resolved')
  expect(eventTypes).toContain('run.resumed')
  expect(eventTypes).toContain('step.retry')
  expect(eventTypes).toContain('guardrail.passed')
  expect(eventTypes).toContain('run.passed')
}
