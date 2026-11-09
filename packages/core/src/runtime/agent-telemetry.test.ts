import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { readLedgerEvents } from '../persistence/ledger-writer.js'
import { readStreamEvents } from '../persistence/stream-writer.js'
import { emitPreTurnEvents, emitTurnCompleted } from './agent-telemetry.js'

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agent-telemetry-test-'))
}

describe('agent telemetry emitters', () => {
  it('emits pre-turn events to ledger and session stream', () => {
    const runDir = makeTempDir()
    try {
      const ctx = {
        runId: 'r-1',
        environments: {},
        steps: {},
        step: { id: 's-1', output: undefined, attempt: 1 },
        matrix: { index: 0, total: 2, item: 'first' },
        artifacts: {} as any,
      }
      emitPreTurnEvents(runDir, ctx, 's-1', 'sess-1', 'do prompt', 'workspace-write', 1)

      const ledger = readLedgerEvents(runDir)
      expect(ledger).toHaveLength(1)
      expect(ledger[0].eventType).toBe('agent.stream.linked')
      expect(ledger[0].matrixIndex).toBe(0)
      expect(ledger[0].payload.sessionId).toBe('sess-1')

      const stream = readStreamEvents(runDir, 'sess-1')
      expect(stream).toHaveLength(1)
      expect(stream[0].eventType).toBe('turn.started')
      expect(stream[0].payload.prompt).toBe('do prompt')
      expect(stream[0].payload.mode).toBe('workspace-write')
    }
    finally {
      fs.rmSync(runDir, { recursive: true, force: true })
    }
  })

  it('emits turn completed event to session stream', () => {
    const runDir = makeTempDir()
    try {
      const ctx = {
        runId: 'r-1',
        environments: {},
        steps: {},
        step: { id: 's-1', output: undefined, attempt: 1 },
        matrix: undefined,
        artifacts: {} as any,
      }
      emitTurnCompleted(runDir, ctx, 's-1', 'sess-1', { result: 'ok' }, 1)

      const stream = readStreamEvents(runDir, 'sess-1')
      expect(stream).toHaveLength(1)
      expect(stream[0].eventType).toBe('turn.completed')
      expect(stream[0].payload.output).toEqual({ result: 'ok' })
    }
    finally {
      fs.rmSync(runDir, { recursive: true, force: true })
    }
  })
})
