import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

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

export class LiveRunTailer {
  private readonly offsets = new Map<string, number>()
  private timer: NodeJS.Timeout | undefined
  private readonly streams = new Set<string>()
  private readonly streamedTextSessions = new Set<string>()
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
    this.flushNewline()
    if (this.timer)
      clearInterval(this.timer)
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

  private handleStreamLine(sessionId: string, line: string): void {
    if (this.stream) {
      this.logLine(line)
      return
    }
    try {
      const event = JSON.parse(line) as StreamRecord
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
    this.readLines(path.join(this.runDir, 'ledger.jsonl'), (line) => {
      try {
        const event = JSON.parse(line) as LedgerRecord
        const stepSuffix = event.stepId !== undefined && event.stepId !== null && event.stepId !== ''
          ? ` ${event.stepId}`
          : ''
        const errorDetail = typeof event.payload?.error === 'string' && event.payload.error.trim() !== ''
          ? `: ${event.payload.error}`
          : ''
        this.logLine(`[${event.eventType ?? 'event'}]${stepSuffix}${errorDetail}`)
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
