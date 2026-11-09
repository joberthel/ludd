import type { ArtifactValidationIssue } from '../types/artifact.js'
import type { GuardrailVerdict } from '../types/guardrail.js'
import fs from 'node:fs'
import path from 'node:path'
import { readLedgerEvents } from '../persistence/ledger-writer.js'
import { formatArtifactRetryPrompt } from './artifact-validator.js'
import { formatGuardrailRetryPrompt } from './guardrail-executor.js'

export interface RehydratedAgentPromptState {
  sessionId?: string | null
  attempt?: number
  matrixIndex?: number | null
  matrixOutputs?: readonly unknown[]
}

export type RetryIssueList = readonly {
  path?: readonly (string | number | symbol)[]
  message: string
}[]

export function formatRetryPrompt(initialPrompt: string, issues: RetryIssueList): string {
  const formatted = issues.map((i) => {
    const p = i.path && i.path.length > 0
      ? i.path.map(String).join('.')
      : '(root)'
    return `- [${p}]: ${i.message}`
  }).join('\n')
  return `Your previous output did not match the required schema:\n${formatted}\n\nPlease correct your output to conform to the schema.\n\nOriginal instruction:\n${initialPrompt}`
}

export function resolveInitialPrompt(
  initialPrompt: string,
  runDir: string,
  stepId: string,
  rehydration?: RehydratedAgentPromptState,
  matrixIndex?: number,
  mcpServerUrl?: string,
): string {
  if (rehydration?.attempt === undefined || rehydration.attempt <= 1) {
    return initialPrompt
  }
  const ledgerPath = path.join(runDir, 'ledger.jsonl')
  if (!fs.existsSync(ledgerPath)) {
    return initialPrompt
  }
  const events = readLedgerEvents(runDir)
  const lastRetry = events.reverse().find(e =>
    e.eventType === 'step.retry' && e.stepId === stepId && e.matrixIndex === matrixIndex,
  )
  if (!lastRetry) {
    return initialPrompt
  }
  const payload = lastRetry.payload as { reason?: string, issues: unknown }
  if (payload.reason === 'artifact_validation_failed') {
    return formatArtifactRetryPrompt(initialPrompt, payload.issues as readonly ArtifactValidationIssue[])
  }
  if (payload.reason === 'guardrail_failed') {
    const issues = payload.issues as { guardrailIndex: number, verdict: GuardrailVerdict<unknown> }
    return formatGuardrailRetryPrompt(initialPrompt, issues.guardrailIndex, issues.verdict, mcpServerUrl)
  }
  return formatRetryPrompt(initialPrompt, payload.issues as RetryIssueList)
}
