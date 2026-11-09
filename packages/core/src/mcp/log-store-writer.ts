import type { ExecLogPaginationConfig, GuardrailVerdict } from '../types/guardrail.js'
import type { LogFormat, LogMetadata, LogStore, OffloadLogOptions } from '../types/log.js'
import type { RunStateSnapshot } from '../types/state.js'
import path from 'node:path'
import { writeRunStateAtomic } from '../persistence/state-store.js'
import { extractJsonItems, splitTextLines, writeAtomic } from './log-store-helpers.js'

export interface LogStoreWriterOptions {
  readonly onLogPersisted?: (key: string, metadata: LogMetadata) => void | Promise<void>
}

async function writeJsonLogFiles(
  logsDir: string,
  indexedKey: string,
  primaryKey: string,
  content: string,
  pagination?: ExecLogPaginationConfig,
): Promise<{ totalItems: number }> {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  }
  catch {
    parsed = content
  }
  const items = extractJsonItems(parsed, pagination)
  const itemsJson = JSON.stringify(items, null, 2)
  await writeAtomic(path.join(logsDir, `${indexedKey}.items.json`), itemsJson)
  await writeAtomic(path.join(logsDir, `${primaryKey}.items.json`), itemsJson)
  return { totalItems: items.length }
}

function resolvePropertyKey(pagination: unknown): string | undefined {
  if (typeof pagination === 'string') {
    return pagination
  }
  if (typeof pagination === 'object' && pagination !== null && 'key' in pagination) {
    return (pagination as { key: string }).key
  }
  return undefined
}

export async function performLogOffload(
  logsDir: string,
  opts: OffloadLogOptions,
  metadataMap: Map<string, LogMetadata>,
  options?: LogStoreWriterOptions,
): Promise<LogMetadata> {
  const isJson = opts.format === 'json' || opts.pagination !== undefined
  const format: LogFormat = isJson ? 'json' : 'text'
  const indexedKey = `${opts.stepId}-${opts.attempt}-${opts.phase}-${opts.guardrailIndex}`
  const primaryKey = `${opts.stepId}-${opts.attempt}`

  const totalItems = isJson
    ? (await writeJsonLogFiles(logsDir, indexedKey, primaryKey, opts.content, opts.pagination)).totalItems
    : undefined
  const totalLines = isJson
    ? undefined
    : splitTextLines(opts.content).length

  await writeAtomic(path.join(logsDir, `${indexedKey}.log`), opts.content)
  await writeAtomic(path.join(logsDir, `${primaryKey}.log`), opts.content)

  const metadata: LogMetadata = {
    logKey: indexedKey,
    format,
    filePath: path.join('logs', `${indexedKey}.log`),
    totalLines,
    totalItems,
    propertyKey: resolvePropertyKey(opts.pagination),
    stepId: opts.stepId,
    attempt: opts.attempt,
    phase: opts.phase,
    guardrailIndex: opts.guardrailIndex,
    createdAt: new Date().toISOString(),
  }
  const primaryMeta: LogMetadata = {
    ...metadata,
    logKey: primaryKey,
    filePath: path.join('logs', `${primaryKey}.log`),
  }

  metadataMap.set(indexedKey, metadata)
  metadataMap.set(`${indexedKey}.log`, metadata)
  metadataMap.set(primaryKey, primaryMeta)
  metadataMap.set(`${primaryKey}.log`, primaryMeta)

  if (options?.onLogPersisted) {
    await options.onLogPersisted(indexedKey, metadata)
    await options.onLogPersisted(primaryKey, primaryMeta)
  }
  return metadata
}

function resolveVerdictLogContent(guardrailIndex: number, verdict: GuardrailVerdict): string {
  if (typeof verdict.rawLog === 'string') {
    return verdict.rawLog
  }
  if (typeof verdict.body === 'string') {
    return verdict.body
  }
  if (verdict.body !== undefined) {
    return JSON.stringify(verdict.body, null, 2)
  }
  return `Guardrail #${guardrailIndex} returned ${verdict.status}`
}

export async function offloadGuardrailLog(
  runDir: string,
  snapshot: RunStateSnapshot,
  stepId: string,
  attempt: number,
  phase: 'beforeStep' | 'afterStep',
  guardrailIndex: number,
  verdict: GuardrailVerdict,
  logStore?: LogStore,
): Promise<LogMetadata> {
  const { createLogStore } = await import('./log-store.js')
  const store = logStore ?? createLogStore(runDir)
  const content = resolveVerdictLogContent(guardrailIndex, verdict)

  const metadata = await store.offload({
    stepId,
    attempt,
    phase,
    guardrailIndex,
    content,
    format: verdict.logFormat,
    pagination: verdict.pagination,
  })

  verdict.logKey = `${stepId}-${attempt}`
  const primaryKey = `${stepId}-${attempt}`
  const indexedKey = `${stepId}-${attempt}-${phase}-${guardrailIndex}`

  snapshot.logs = snapshot.logs ?? {}
  snapshot.logs[indexedKey] = metadata
  snapshot.logs[primaryKey] = {
    ...metadata,
    logKey: primaryKey,
    filePath: path.join('logs', `${primaryKey}.log`),
  }
  snapshot.updatedAt = new Date().toISOString()
  writeRunStateAtomic(runDir, snapshot)

  return metadata
}
