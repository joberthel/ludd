import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { appendLedgerEvent } from '../persistence/ledger-writer.js'
import { resolveInitialPrompt } from './agent-prompt.js'

describe('resolveInitialPrompt', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ludd-agent-prompt-'))
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('returns initialPrompt when rehydration attempt is undefined or <= 1', () => {
    expect(resolveInitialPrompt('Do work', tempDir, 'step-1')).toBe('Do work')
    expect(resolveInitialPrompt('Do work', tempDir, 'step-1', { attempt: 1 })).toBe('Do work')
  })

  it('returns initialPrompt when ledger.jsonl does not exist', () => {
    const missingDir = path.join(tempDir, 'missing-run')
    expect(resolveInitialPrompt('Do work', missingDir, 'step-1', { attempt: 2 })).toBe('Do work')
  })

  it('uses the last matching step.retry event without mutating', () => {
    appendLedgerEvent(tempDir, {
      schemaVersion: 1,
      timestamp: '2026-11-08T20:00:00.000Z',
      runId: 'run-1',
      stepId: 'step-1',
      eventType: 'step.retry',
      payload: {
        issues: [
          {
            path: ['a'],
            message: 'first error',
          },
        ],
      },
    })
    appendLedgerEvent(tempDir, {
      schemaVersion: 1,
      timestamp: '2026-11-08T20:01:00.000Z',
      runId: 'run-1',
      stepId: 'step-1',
      eventType: 'step.retry',
      payload: {
        issues: [
          {
            path: ['b'],
            message: 'second error',
          },
        ],
      },
    })

    const resolved = resolveInitialPrompt('Do work', tempDir, 'step-1', { attempt: 3 })
    expect(resolved).toContain('[b]: second error')
    expect(resolved).not.toContain('first error')
  })
})
