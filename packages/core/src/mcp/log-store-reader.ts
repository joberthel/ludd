import type {
  LogFormat,
  LogMetadata,
  ReadLogLinesResult,
  ReadLogPageResult,
  SearchLogMatch,
  SearchLogResult,
} from '../types/log.js'
import fs from 'node:fs'
import path from 'node:path'
import { sanitizeLogKey, splitTextLines } from './log-store-helpers.js'

export async function resolveLogMetadata(
  logsDir: string,
  key: string,
  metadataMap: Map<string, LogMetadata>,
): Promise<LogMetadata | null> {
  const baseKey = sanitizeLogKey(key)
  const cached = metadataMap.get(baseKey)
  if (cached) {
    return cached
  }
  const logPath = path.join(logsDir, `${baseKey}.log`)
  const itemsPath = path.join(logsDir, `${baseKey}.items.json`)
  const hasItems = await fs.promises.stat(itemsPath).then(s => s.isFile()).catch(() => false)
  const hasLog = await fs.promises.stat(logPath).then(s => s.isFile()).catch(() => false)
  if (!hasItems && !hasLog) {
    return null
  }
  const format: LogFormat = hasItems ? 'json' : 'text'
  const totalItems = hasItems
    ? (JSON.parse(await fs.promises.readFile(itemsPath, 'utf8')) as unknown[]).length
    : undefined
  const totalLines = hasLog && !hasItems
    ? splitTextLines(await fs.promises.readFile(logPath, 'utf8')).length
    : undefined

  const meta: LogMetadata = {
    logKey: baseKey,
    format,
    filePath: path.join('logs', `${baseKey}.log`),
    totalLines,
    totalItems,
  }
  metadataMap.set(baseKey, meta)
  metadataMap.set(`${baseKey}.log`, meta)
  return meta
}

export async function performReadPage(
  logsDir: string,
  key: string,
  page = 1,
  pageSize = 100,
  metadataMap: Map<string, LogMetadata>,
): Promise<ReadLogPageResult | null> {
  const baseKey = sanitizeLogKey(key)
  const meta = await resolveLogMetadata(logsDir, baseKey, metadataMap)
  if (!meta) {
    return null
  }
  const safePage = Math.max(1, page)
  const safePageSize = Math.max(1, pageSize)
  const start = (safePage - 1) * safePageSize

  if (meta.format === 'json') {
    const itemsRaw = await fs.promises.readFile(path.join(logsDir, `${baseKey}.items.json`), 'utf8')
    const items = JSON.parse(itemsRaw) as unknown[]
    const totalItems = items.length
    const totalPages = totalItems === 0
      ? 0
      : Math.ceil(totalItems / safePageSize)
    return {
      logKey: baseKey,
      format: 'json',
      items: items.slice(start, start + safePageSize),
      page: safePage,
      pageSize: safePageSize,
      totalPages,
      totalItems,
    }
  }

  const rawText = await fs.promises.readFile(path.join(logsDir, `${baseKey}.log`), 'utf8')
  const lines = splitTextLines(rawText)
  const totalLines = lines.length
  const totalPages = totalLines === 0
    ? 0
    : Math.ceil(totalLines / safePageSize)
  return {
    logKey: baseKey,
    format: 'text',
    lines: lines.slice(start, start + safePageSize),
    page: safePage,
    pageSize: safePageSize,
    totalPages,
    totalLines,
  }
}

export async function performReadLines(
  logsDir: string,
  key: string,
  startLine: number,
  endLine: number,
): Promise<ReadLogLinesResult | null> {
  const baseKey = sanitizeLogKey(key)
  const logPath = path.join(logsDir, `${baseKey}.log`)
  const exists = await fs.promises.stat(logPath).then(s => s.isFile()).catch(() => false)
  if (!exists) {
    return null
  }
  const rawText = await fs.promises.readFile(logPath, 'utf8')
  const lines = splitTextLines(rawText)
  const totalLines = lines.length
  const start = Math.max(1, startLine)
  const slice = start > endLine
    ? []
    : lines.slice(start - 1, endLine)
  return {
    logKey: baseKey,
    startLine,
    endLine,
    totalLines,
    lines: slice,
  }
}

export async function performSearch(
  logsDir: string,
  key: string,
  query: string,
  maxMatches = 50,
): Promise<SearchLogResult | null> {
  const baseKey = sanitizeLogKey(key)
  const logPath = path.join(logsDir, `${baseKey}.log`)
  const exists = await fs.promises.stat(logPath).then(s => s.isFile()).catch(() => false)
  if (!exists) {
    return null
  }
  const lines = splitTextLines(await fs.promises.readFile(logPath, 'utf8'))
  if (query === '') {
    return {
      logKey: baseKey,
      query,
      totalMatches: 0,
      matches: [],
    }
  }
  const lowerQuery = query.toLowerCase()
  const allMatches: SearchLogMatch[] = []
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].toLowerCase().includes(lowerQuery)) {
      allMatches.push({ lineNumber: i + 1, text: lines[i] })
    }
  }
  const safeMax = Math.max(1, maxMatches)
  return {
    logKey: baseKey,
    query,
    totalMatches: allMatches.length,
    matches: allMatches.slice(0, safeMax),
  }
}

export async function checkLogExists(logsDir: string, key: string): Promise<boolean> {
  const baseKey = sanitizeLogKey(key)
  const logPath = path.join(logsDir, `${baseKey}.log`)
  return fs.promises.stat(logPath).then(s => s.isFile()).catch(() => false)
}
