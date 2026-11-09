import type { LogMetadata, LogStore } from '../types/log.js'
import type { LogStoreWriterOptions } from './log-store-writer.js'
import path from 'node:path'
import {
  checkLogExists,
  performReadLines,
  performReadPage,
  performSearch,
  resolveLogMetadata,
} from './log-store-reader.js'
import {
  performLogOffload,
} from './log-store-writer.js'

export { sanitizeLogKey } from './log-store-helpers.js'
export { offloadGuardrailLog } from './log-store-writer.js'

export type LogStoreOptions = LogStoreWriterOptions

export function createLogStore(runDir: string, options?: LogStoreOptions): LogStore {
  const logsDir = path.resolve(runDir, 'logs')
  const metadataMap = new Map<string, LogMetadata>()

  return {
    runDir,
    offload: async opts => performLogOffload(logsDir, opts, metadataMap, options),
    readPage: async (key, page, pageSize) => performReadPage(logsDir, key, page, pageSize, metadataMap),
    readLines: async (key, start, end) => performReadLines(logsDir, key, start, end),
    search: async (key, query, maxMatches) => performSearch(logsDir, key, query, maxMatches),
    getMetadata: async key => resolveLogMetadata(logsDir, key, metadataMap),
    has: async key => checkLogExists(logsDir, key),
  }
}
