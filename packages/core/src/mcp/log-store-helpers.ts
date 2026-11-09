import type { ExecLogPaginationConfig } from '../types/guardrail.js'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

export function sanitizeLogKey(key: string): string {
  if (typeof key !== 'string' || key.trim() === '') {
    throw new Error('Log key must be a non-empty string.')
  }
  if (key.includes('\0')) {
    throw new Error('Log key cannot contain null bytes.')
  }
  let cleaned = key.trim().replace(/\\/g, '/')
  while (cleaned.startsWith('/')) {
    cleaned = cleaned.slice(1)
  }
  if (cleaned.startsWith('logs/')) {
    cleaned = cleaned.slice(5)
  }
  const basename = path.basename(cleaned)
  if (basename === '.' || basename === '..' || basename === '') {
    throw new Error(`Log key contains invalid path segment: "${key}".`)
  }
  if (basename.endsWith('.items.json')) {
    return basename.slice(0, -11)
  }
  if (basename.endsWith('.log')) {
    return basename.slice(0, -4)
  }
  return basename
}

export function extractByDotPath(obj: unknown, dotPath: string): unknown {
  if (typeof obj !== 'object' || obj === null) {
    return undefined
  }
  const parts = dotPath.split('.')
  let current: unknown = obj
  for (const part of parts) {
    if (typeof current !== 'object' || current === null || !(part in current)) {
      return undefined
    }
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

export function extractJsonItems(parsed: unknown, pagination?: ExecLogPaginationConfig): readonly unknown[] {
  if (typeof pagination === 'function') {
    const res = pagination(parsed)
    return Array.isArray(res)
      ? res
      : []
  }
  if (typeof pagination === 'string') {
    const res = extractByDotPath(parsed, pagination)
    if (Array.isArray(res)) {
      return res
    }
    return Array.isArray(parsed)
      ? parsed
      : []
  }
  if (typeof pagination === 'object' && pagination !== null && 'key' in pagination) {
    const res = extractByDotPath(parsed, pagination.key)
    if (Array.isArray(res)) {
      return res
    }
    return Array.isArray(parsed)
      ? parsed
      : []
  }
  if (Array.isArray(parsed)) {
    return parsed
  }
  if (typeof parsed === 'object' && parsed !== null) {
    const rec = parsed as Record<string, unknown>
    if (Array.isArray(rec.errors)) {
      return rec.errors
    }
    if (Array.isArray(rec.items)) {
      return rec.items
    }
    return [parsed]
  }
  return []
}

export function splitTextLines(content: string): string[] {
  const normalized = content.replace(/\r\n/g, '\n')
  if (normalized === '') {
    return []
  }
  const trimmed = normalized.endsWith('\n')
    ? normalized.slice(0, -1)
    : normalized
  return trimmed.split('\n')
}

export async function writeAtomic(targetPath: string, content: string): Promise<void> {
  const dir = path.dirname(targetPath)
  await fs.promises.mkdir(dir, { recursive: true })
  const tmp = `${targetPath}.${randomUUID()}.tmp`
  await fs.promises.writeFile(tmp, content, 'utf8')
  await fs.promises.rename(tmp, targetPath)
}
