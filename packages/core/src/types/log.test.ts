import type { LogFormat, LogMetadata, LogStore, ReadLogPageResult } from './log.js'
import { describe, expect, it } from 'vitest'

describe('log types', () => {
  it('allows constructing compliant LogMetadata and ReadLogPageResult', () => {
    const format: LogFormat = 'text'
    const metadata: LogMetadata = {
      logKey: 'step-1-1',
      format,
      totalLines: 10,
    }
    expect(metadata.logKey).toBe('step-1-1')

    const pageResult: ReadLogPageResult = {
      logKey: 'step-1-1',
      format: 'text',
      lines: ['a', 'b'],
      page: 1,
      pageSize: 2,
      totalPages: 1,
      totalLines: 2,
    }
    expect(pageResult.format).toBe('text')

    const store: Partial<LogStore> = {
      runDir: '/tmp/run',
    }
    expect(store.runDir).toBe('/tmp/run')
  })
})
