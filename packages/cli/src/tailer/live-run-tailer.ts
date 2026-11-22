import type { RunUiHost } from '../ui/run-ui-bridge.js'
import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { formatToolArgsSummary, getRunUiHost } from '../ui/run-ui-bridge.js'

interface LedgerRecord {
  eventType?: string
  stepId?: string | null
  payload?: Record<string, unknown>
}

interface StreamRecord {
  eventType?: string
  stepId?: string | null
  payload?: Record<string, unknown>
}

function formatOutputValue(value: unknown): string {
  return typeof value === 'string'
    ? value
    : JSON.stringify(value)
}

function formatToolCall(payload: Record<string, unknown>): string | undefined {
  const name = typeof payload.toolName === 'string'
    ? payload.toolName
    : 'tool'
  if (payload.phase === 'start') {
    const args = payload.args !== undefined && payload.args !== null
      ? ` ${JSON.stringify(payload.args)}`
      : ''
    return `[tool] ${name}${args}`
  }
  if (payload.phase === 'end' && payload.isError === true) {
    return `[tool.error] ${name}`
  }
  return undefined
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== ''
    ? value
    : undefined
}

function emitLedgerToUi(event: LedgerRecord, uiHost: RunUiHost): void {
  const stepId = nonEmptyString(event.stepId) ?? 'step'
  const payload = event.payload ?? {}
  const error = nonEmptyString(payload.error)
  const guardrailName = nonEmptyString(payload.guardrailName)
  switch (event.eventType ?? '') {
    case 'run.started':
      uiHost.pushEntry({ kind: 'run.started', harnessName: nonEmptyString(payload.harnessName) ?? 'ludd' })
      break
    case 'run.resumed':
      uiHost.pushEntry({
        kind: 'run.resumed',
        harnessName: nonEmptyString(payload.harnessName),
      })
      break
    case 'run.passed':
      uiHost.setActivity(undefined)
      uiHost.pushEntry({ kind: 'run.passed' })
      break
    case 'run.failed':
      uiHost.setActivity(undefined)
      uiHost.pushEntry({ kind: 'run.failed', error })
      break
    case 'step.started':
      uiHost.pushEntry({ kind: 'step.started', stepId })
      uiHost.setActivity(`${stepId} · running...`)
      break
    case 'step.passed':
      uiHost.setActivity(undefined)
      uiHost.pushEntry({ kind: 'step.passed', stepId })
      break
    case 'step.skipped':
      uiHost.setActivity(undefined)
      uiHost.pushEntry({ kind: 'step.skipped', stepId })
      break
    case 'step.failed':
      uiHost.setActivity(undefined)
      uiHost.pushEntry({ kind: 'step.failed', stepId, error })
      break
    case 'step.retry':
      uiHost.pushEntry({
        kind: 'step.retry',
        stepId,
        attempt: typeof payload.attempt === 'number'
          ? payload.attempt
          : undefined,
      })
      uiHost.setActivity(`${stepId} · retrying...`)
      break
    case 'guardrail.started':
      uiHost.setActivity(
        guardrailName !== undefined
          ? `${stepId} · running guardrail ${guardrailName}...`
          : `${stepId} · running guardrail...`,
      )
      break
    case 'guardrail.passed':
      uiHost.pushEntry({
        kind: 'guardrail.passed',
        ...(guardrailName !== undefined
          ? { name: guardrailName }
          : {}),
      })
      break
    case 'guardrail.skipped':
      uiHost.pushEntry({
        kind: 'guardrail.skipped',
        ...(guardrailName !== undefined
          ? { name: guardrailName }
          : {}),
      })
      break
    case 'guardrail.failed':
      uiHost.pushEntry({
        kind: 'guardrail.failed',
        ...(guardrailName !== undefined
          ? { name: guardrailName }
          : {}),
      })
      break
    case 'gate.waiting':
      uiHost.setActivity(undefined)
      break
    default:
      break
  }
}

export class LiveRunTailer {
  private readonly offsets = new Map<string, number>()
  private timer: NodeJS.Timeout | undefined
  private readonly streams = new Set<string>()
  private readonly streamedTextSessions = new Set<string>()
  private readonly uiTextBuffers = new Map<string, string>()
  private needsNewline = false

  constructor(private readonly runDir: string, private readonly stream: boolean) {}

  start(): void {
    this.timer = setInterval(() => this.poll(), 100)
    this.timer.unref()
  }

  stop(): void {
    // Drain events written after the last interval tick so short runs still
    // show their final status in the foreground CLI.
    this.poll()
    this.flushAllUiBuffers()
    const uiHost = this.activeUiHost()
    uiHost?.setActivity(undefined)
    this.flushNewline()
    if (this.timer)
      clearInterval(this.timer)
  }

  private activeUiHost(): RunUiHost | undefined {
    return this.stream
      ? undefined
      : getRunUiHost()
  }

  private flushUiBuffer(sessionId: string, uiHost: RunUiHost): void {
    const buffered = this.uiTextBuffers.get(sessionId)?.trim()
    this.uiTextBuffers.delete(sessionId)
    if (buffered !== undefined && buffered.length > 0) {
      uiHost.pushEntry({ kind: 'agent.text', text: buffered })
    }
  }

  private flushAllUiBuffers(): void {
    const uiHost = this.activeUiHost()
    if (!uiHost)
      return
    for (const id of [
      ...this.uiTextBuffers.keys(),
    ]) {
      this.flushUiBuffer(id, uiHost)
    }
  }

  private flushNewline(): void {
    if (!this.needsNewline)
      return
    process.stdout.write('\n')
    this.needsNewline = false
  }

  private logLine(line: string): void {
    this.flushNewline()
    console.log(line)
  }

  private readLines(file: string, callback: (line: string) => void): void {
    if (!fs.existsSync(file))
      return
    const stat = fs.statSync(file)
    const offset = this.offsets.get(file) ?? 0
    if (stat.size < offset)
      this.offsets.set(file, 0)
    const current = this.offsets.get(file) ?? 0
    if (stat.size === current)
      return
    const fd = fs.openSync(file, 'r')
    try {
      const buffer = Buffer.alloc(stat.size - current)
      fs.readSync(fd, buffer, 0, buffer.length, current)
      const lastNewline = buffer.lastIndexOf(0x0A)
      if (lastNewline === -1)
        return
      this.offsets.set(file, current + lastNewline + 1)
      const chunk = buffer.subarray(0, lastNewline).toString('utf8')
      for (const line of chunk.split('\n').filter(Boolean)) callback(line)
    }
    finally { fs.closeSync(fd) }
  }

  private handleStreamEventForUi(sessionId: string, event: StreamRecord, uiHost: RunUiHost): void {
    const payload = event.payload ?? {}
    const stepId = nonEmptyString(event.stepId) ?? 'step'
    if (event.eventType === 'turn.started') {
      this.streamedTextSessions.delete(sessionId)
      this.uiTextBuffers.delete(sessionId)
      uiHost.setActivity(`${stepId} · thinking...`)
      return
    }
    if (event.eventType === 'message_chunk' && typeof payload.text === 'string' && payload.text.length > 0) {
      this.streamedTextSessions.add(sessionId)
      this.uiTextBuffers.set(sessionId, `${this.uiTextBuffers.get(sessionId) ?? ''}${payload.text}`)
      return
    }
    if (event.eventType === 'tool_call') {
      const toolName = nonEmptyString(payload.toolName) ?? 'tool'
      if (toolName === 'ask_user')
        return
      this.flushUiBuffer(sessionId, uiHost)
      if (payload.phase === 'start') {
        uiHost.pushEntry({
          kind: 'tool.start',
          toolName,
          argsSummary: formatToolArgsSummary(payload.args),
        })
        uiHost.setActivity(`${stepId} · running ${toolName}...`)
      }
      else if (payload.phase === 'end') {
        if (payload.isError === true)
          uiHost.pushEntry({ kind: 'tool.error', toolName })
        uiHost.setActivity(`${stepId} · thinking...`)
      }
      return
    }
    if (event.eventType === 'turn.completed') {
      this.flushUiBuffer(sessionId, uiHost)
      if (payload.output !== undefined && payload.output !== '') {
        if (typeof payload.output === 'string' && this.streamedTextSessions.has(sessionId))
          return
        uiHost.pushEntry({
          kind: 'agent.output',
          output: formatOutputValue(payload.output),
        })
      }
    }
  }

  private handleStreamLine(sessionId: string, line: string): void {
    if (this.stream) {
      this.logLine(line)
      return
    }
    try {
      const event = JSON.parse(line) as StreamRecord
      const uiHost = this.activeUiHost()
      if (uiHost !== undefined) {
        this.handleStreamEventForUi(sessionId, event, uiHost)
        return
      }
      const payload = event.payload ?? {}
      if (event.eventType === 'turn.started') {
        this.streamedTextSessions.delete(sessionId)
        return
      }
      if (event.eventType === 'message_chunk' && typeof payload.text === 'string' && payload.text.length > 0) {
        process.stdout.write(payload.text)
        this.streamedTextSessions.add(sessionId)
        this.needsNewline = !payload.text.endsWith('\n')
        return
      }
      if (event.eventType === 'tool_call') {
        const formatted = formatToolCall(payload)
        if (formatted !== undefined)
          this.logLine(formatted)
        return
      }
      if (event.eventType === 'turn.completed' && payload.output !== undefined && payload.output !== '') {
        if (typeof payload.output === 'string' && this.streamedTextSessions.has(sessionId))
          return
        const stepSuffix = event.stepId !== undefined && event.stepId !== null && event.stepId !== ''
          ? ` ${event.stepId}`
          : ''
        this.logLine(`[agent.output]${stepSuffix}: ${formatOutputValue(payload.output)}`)
      }
    }
    catch { /* Ignore malformed stream JSONL records. */ }
  }

  private poll(): void {
    const uiHost = this.activeUiHost()
    this.readLines(path.join(this.runDir, 'ledger.jsonl'), (line) => {
      try {
        const event = JSON.parse(line) as LedgerRecord
        if (uiHost !== undefined) {
          this.flushAllUiBuffers()
          emitLedgerToUi(event, uiHost)
        }
        else {
          const stepSuffix = event.stepId !== undefined && event.stepId !== null && event.stepId !== ''
            ? ` ${event.stepId}`
            : ''
          const guardrailName = event.eventType?.startsWith('guardrail.') === true
            ? nonEmptyString(event.payload?.guardrailName)
            : undefined
          const guardrailSuffix = guardrailName !== undefined
            ? ` (${guardrailName})`
            : ''
          const errorDetail = typeof event.payload?.error === 'string' && event.payload.error.trim() !== ''
            ? `: ${event.payload.error}`
            : ''
          this.logLine(`[${event.eventType ?? 'event'}]${stepSuffix}${guardrailSuffix}${errorDetail}`)
        }
        if (event.eventType !== 'agent.stream.linked')
          return
        const sessionId = event.payload?.sessionId
        if (typeof sessionId === 'string')
          this.streams.add(sessionId)
      }
      catch { /* Ignore incomplete JSONL records. */ }
    })
    for (const id of this.streams) {
      this.readLines(path.join(this.runDir, 'streams', `${id}.jsonl`), line => this.handleStreamLine(id, line))
    }
  }
}
