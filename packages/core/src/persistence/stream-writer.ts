import type { AgentStreamEvent } from '../types/stream.js'
import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { SchemaVersionMismatchError } from '../errors/schema-version-mismatch-error.js'
import { SUPPORTED_SCHEMA_VERSION } from './state-store.js'

export const agentStreamEventTypeSchema = z.enum([
  'turn.started',
  'thought',
  'tool_call',
  'message_chunk',
  'turn.completed',
])

export const agentStreamEventSchema = z.object({
  schemaVersion: z.literal(SUPPORTED_SCHEMA_VERSION),
  timestamp: z.string(),
  runId: z.string(),
  stepId: z.string(),
  sessionId: z.string(),
  attempt: z.number(),
  eventType: agentStreamEventTypeSchema,
  payload: z.record(z.string(), z.unknown()),
})

export function resolveStreamPath(runDir: string, sessionId: string): string {
  return path.join(runDir, 'streams', `${sessionId}.jsonl`)
}

export function appendStreamEvent(
  runDir: string,
  sessionId: string,
  event: AgentStreamEvent,
): void {
  const streamsDir = path.join(runDir, 'streams')
  fs.mkdirSync(streamsDir, { recursive: true })
  const streamPath = resolveStreamPath(runDir, sessionId)
  fs.appendFileSync(streamPath, `${JSON.stringify(event)}\n`, 'utf8')
}

export function readStreamEvents(
  runDir: string,
  sessionId: string,
): AgentStreamEvent[] {
  const streamPath = resolveStreamPath(runDir, sessionId)
  if (!fs.existsSync(streamPath)) {
    return []
  }
  const content = fs.readFileSync(streamPath, 'utf8')
  const lines = content.split('\n').filter(line => line.trim() !== '')

  return lines.map((line, index) => {
    let entry: unknown
    try {
      entry = JSON.parse(line)
    }
    catch (err: unknown) {
      throw new Error(
        `Failed to parse stream event at line ${index + 1} in "${streamPath}": ${String(err)}`,
      )
    }

    if (
      typeof entry !== 'object'
      || entry === null
      || (entry as Record<string, unknown>).schemaVersion !== SUPPORTED_SCHEMA_VERSION
    ) {
      const actualVersion = typeof entry === 'object' && entry !== null
        ? (entry as Record<string, unknown>).schemaVersion
        : undefined
      throw new SchemaVersionMismatchError(SUPPORTED_SCHEMA_VERSION, actualVersion, streamPath)
    }

    return agentStreamEventSchema.parse(entry)
  })
}
