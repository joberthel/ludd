import type { LogStore } from '../types/log.js'
import { describe, expect, it, vi } from 'vitest'
import {
  executeLogToolCall,
  handleReadLogLines,
  handleReadLogPage,
  handleSearchLog,
  MCP_LOG_TOOLS_LIST,
} from './mcp-log-tools.js'

describe('mcp-log-tools schema definitions', () => {
  it('exposes tool definitions for read_log_page, read_log_lines, and search_log', () => {
    expect(MCP_LOG_TOOLS_LIST.map(t => t.name)).toEqual([
      'read_log_page',
      'read_log_lines',
      'search_log',
    ])
  })
})

describe('handleReadLogPage', () => {
  it('validates arguments and returns error on invalid input', async () => {
    const mockStore: Partial<LogStore> = {
      readPage: vi.fn(),
    }
    const res1 = await handleReadLogPage({}, mockStore as LogStore)
    expect(res1.isError).toBe(true)
    expect(res1.content[0].text).toContain('Invalid arguments')

    const res2 = await handleReadLogPage({ logKey: '   ' }, mockStore as LogStore)
    expect(res2.isError).toBe(true)
  })

  it('returns error when log is not found', async () => {
    const mockStore: Partial<LogStore> = {
      readPage: vi.fn().mockResolvedValue(null),
    }
    const res = await handleReadLogPage({ logKey: 'missing' }, mockStore as LogStore)
    expect(res.isError).toBe(true)
    expect(res.content[0].text).toBe('Log "missing" not found.')
  })

  it('returns formatted json on successful readPage', async () => {
    const mockResult = {
      logKey: 'step-1',
      format: 'text' as const,
      lines: ['a', 'b'],
      page: 1,
      pageSize: 10,
      totalPages: 1,
      totalLines: 2,
    }
    const mockStore: Partial<LogStore> = {
      readPage: vi.fn().mockResolvedValue(mockResult),
    }
    const res = await handleReadLogPage({ logKey: 'step-1', page: 1, pageSize: 10 }, mockStore as LogStore)
    expect(res.isError).toBeUndefined()
    expect(JSON.parse(res.content[0].text)).toEqual(mockResult)
  })
})

describe('handleReadLogLines', () => {
  it('validates arguments and returns error on missing or non-number lines', async () => {
    const mockStore: Partial<LogStore> = {
      readLines: vi.fn(),
    }
    const res1 = await handleReadLogLines({ logKey: 123 }, mockStore as LogStore)
    expect(res1.isError).toBe(true)

    const res2 = await handleReadLogLines({ logKey: 'step-1', startLine: '1', endLine: 5 }, mockStore as LogStore)
    expect(res2.isError).toBe(true)
    expect(res2.content[0].text).toContain('must be numbers')
  })

  it('returns error when log is not found', async () => {
    const mockStore: Partial<LogStore> = {
      readLines: vi.fn().mockResolvedValue(null),
    }
    const res = await handleReadLogLines({ logKey: 'missing', startLine: 1, endLine: 5 }, mockStore as LogStore)
    expect(res.isError).toBe(true)
  })

  it('returns formatted json on successful readLines', async () => {
    const mockResult = {
      logKey: 'step-1',
      startLine: 1,
      endLine: 2,
      totalLines: 5,
      lines: ['line 1', 'line 2'],
    }
    const mockStore: Partial<LogStore> = {
      readLines: vi.fn().mockResolvedValue(mockResult),
    }
    const res = await handleReadLogLines({ logKey: 'step-1', startLine: 1, endLine: 2 }, mockStore as LogStore)
    expect(res.isError).toBeUndefined()
    expect(JSON.parse(res.content[0].text)).toEqual(mockResult)
  })
})

describe('handleSearchLog', () => {
  it('validates arguments and returns error on invalid input', async () => {
    const mockStore: Partial<LogStore> = {
      search: vi.fn(),
    }
    const res1 = await handleSearchLog({}, mockStore as LogStore)
    expect(res1.isError).toBe(true)

    const res2 = await handleSearchLog({ logKey: 'step-1', query: 123 }, mockStore as LogStore)
    expect(res2.isError).toBe(true)
    expect(res2.content[0].text).toContain('"query" must be a string')
  })

  it('returns error when log is not found', async () => {
    const mockStore: Partial<LogStore> = {
      search: vi.fn().mockResolvedValue(null),
    }
    const res = await handleSearchLog({ logKey: 'missing', query: 'err' }, mockStore as LogStore)
    expect(res.isError).toBe(true)
  })

  it('returns formatted json on successful search', async () => {
    const mockResult = {
      logKey: 'step-1',
      query: 'err',
      totalMatches: 1,
      matches: [
        { lineNumber: 2, text: 'error line' },
      ],
    }
    const mockStore: Partial<LogStore> = {
      search: vi.fn().mockResolvedValue(mockResult),
    }
    const res = await handleSearchLog({ logKey: 'step-1', query: 'err', maxMatches: 10 }, mockStore as LogStore)
    expect(res.isError).toBeUndefined()
    expect(JSON.parse(res.content[0].text)).toEqual(mockResult)
  })
})

describe('executeLogToolCall dispatching', () => {
  it('dispatches known tools and rejects unknown tools', async () => {
    const mockStore: Partial<LogStore> = {
      readPage: vi.fn().mockResolvedValue({}),
      readLines: vi.fn().mockResolvedValue({}),
      search: vi.fn().mockResolvedValue({}),
    }
    const p1 = await executeLogToolCall('read_log_page', { logKey: 'k' }, mockStore as LogStore)
    expect(p1.isError).toBeUndefined()

    const p2 = await executeLogToolCall('read_log_lines', { logKey: 'k', startLine: 1, endLine: 2 }, mockStore as LogStore)
    expect(p2.isError).toBeUndefined()

    const p3 = await executeLogToolCall('search_log', { logKey: 'k', query: 'q' }, mockStore as LogStore)
    expect(p3.isError).toBeUndefined()

    const p4 = await executeLogToolCall('unknown', {}, mockStore as LogStore)
    expect(p4.isError).toBe(true)
    expect(p4.content[0].text).toContain('Unknown tool')
  })
})
