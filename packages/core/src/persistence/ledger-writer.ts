import type { LedgerEvent } from '../types/ledger.js'
import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { SchemaVersionMismatchError } from '../errors/schema-version-mismatch-error.js'
import { SUPPORTED_SCHEMA_VERSION } from './state-store.js'

export const ledgerEventTypeSchema = z.enum([
  'run.started',
  'run.resumed',
  'run.passed',
  'run.failed',
  'step.started',
  'step.passed',
  'step.skipped',
  'step.failed',
  'step.retry',
  'agent.stream.linked',
])

export const ledgerEventSchema = z.object({
  schemaVersion: z.literal(SUPPORTED_SCHEMA_VERSION),
  timestamp: z.string(),
  runId: z.string(),
  stepId: z.string().nullable(),
  matrixIndex: z.number().int().nonnegative().optional(),
  eventType: ledgerEventTypeSchema,
  payload: z.record(z.string(), z.unknown()),
})

export function appendLedgerEvent(runDir: string, event: LedgerEvent): void {
  fs.mkdirSync(runDir, { recursive: true })
  const ledgerPath = path.join(runDir, 'ledger.jsonl')
  fs.appendFileSync(ledgerPath, `${JSON.stringify(event)}\n`, 'utf8')
}

export function readLedgerEvents(runDir: string): LedgerEvent[] {
  const ledgerPath = path.join(runDir, 'ledger.jsonl')
  const content = fs.readFileSync(ledgerPath, 'utf8')
  const lines = content.split('\n').filter(line => line.trim() !== '')

  return lines.map((line) => {
    const entry = JSON.parse(line) as unknown
    if (
      typeof entry !== 'object'
      || entry === null
      || (entry as Record<string, unknown>).schemaVersion !== SUPPORTED_SCHEMA_VERSION
    ) {
      const actualVersion = typeof entry === 'object' && entry !== null
        ? (entry as Record<string, unknown>).schemaVersion
        : undefined
      throw new SchemaVersionMismatchError(SUPPORTED_SCHEMA_VERSION, actualVersion, ledgerPath)
    }

    return ledgerEventSchema.parse(entry)
  })
}
