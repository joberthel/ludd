import type { RunUiHost, UiLogPhase, UiLogScope } from '../ui/run-ui-bridge.js'
import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { formatToolArgsSummary, getRunUiHost } from '../ui/run-ui-bridge.js'

interface LedgerRecord {
  eventType?: string
  stepId?: string | null
  matrixIndex?: number | null
  payload?: Record<string, unknown>
}

interface StreamRecord {
  eventType?: string
  stepId?: string | null
  matrixIndex?: number | null
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

function parseUiPhase(value: unknown): UiLogPhase | undefined {
  return value === 'beforeStep' || value === 'interactive' || value === 'run' || value === 'afterStep'
    ? value
    : undefined
}

function buildScope(
  event: { stepId?: string | null, matrixIndex?: number | null, payload?: Record<string, unknown> },
  defaultPhase?: UiLogPhase,
): UiLogScope | undefined {
  const payload = event.payload ?? {}
  const stepId = nonEmptyString(event.stepId)
  const matrixIndex = typeof event.matrixIndex === 'number'
    ? event.matrixIndex
    : typeof payload.matrixIndex === 'number'
      ? payload.matrixIndex
      : undefined
  const matrixTotal = typeof payload.matrixTotal === 'number'
    ? payload.matrixTotal
    : undefined
  const phase = parseUiPhase(payload.phase) ?? (stepId !== undefined
    ? defaultPhase
    : undefined)
  const guardrailIndex = typeof payload.guardrailIndex === 'number'
    ? payload.guardrailIndex
    : undefined
  const guardrailName = nonEmptyString(payload.guardrailName)
  const attempt = typeof payload.attempt === 'number'
    ? payload.attempt
    : undefined

  const scope: UiLogScope = {
    ...(stepId !== undefined
      ? { stepId }
      : {}),
    ...(matrixIndex !== undefined
      ? { matrixIndex }
      : {}),
    ...(matrixTotal !== undefined
      ? { matrixTotal }
      : {}),
    ...(phase !== undefined
      ? { phase }
      : {}),
    ...(guardrailIndex !== undefined
      ? { guardrailIndex }
      : {}),
    ...(guardrailName !== undefined
      ? { guardrailName }
      : {}),
    ...(attempt !== undefined
      ? { attempt }
      : {}),
  }
  return Object.keys(scope).length > 0
    ? scope
    : undefined
}

function withScope<T extends Record<string, unknown>>(entry: T, scope: UiLogScope | undefined): T & { scope?: UiLogScope } {
  return scope !== undefined
    ? { ...entry, scope }
    : entry
}

function extractGuardrailOutput(verdict: unknown): { output?: string, logKey?: string } {
  if (typeof verdict !== 'object' || verdict === null) {
    return {}
  }
  const record = verdict as Record<string, unknown>
  const logKey = nonEmptyString(record.logKey)
  const rawLog = nonEmptyString(record.rawLog)

  let bodyStr: string | undefined
  if (typeof record.body === 'string') {
    bodyStr = nonEmptyString(record.body)
  }
  else if (record.body !== undefined && record.body !== null) {
    bodyStr = nonEmptyString(JSON.stringify(record.body, null, 2))
  }

  let output: string | undefined
  if (bodyStr !== undefined && rawLog !== undefined) {
    output = bodyStr === rawLog || rawLog.includes(bodyStr)
      ? rawLog
      : `${bodyStr}\n${rawLog}`
  }
  else {
    output = rawLog ?? bodyStr
  }

  return {
    ...(output !== undefined
      ? { output }
      : {}),
    ...(logKey !== undefined
      ? { logKey }
      : {}),
  }
}

function emitLedgerToUi(event: LedgerRecord, uiHost: RunUiHost): void {
  const stepId = nonEmptyString(event.stepId) ?? 'step'
  const payload = event.payload ?? {}
  const error = nonEmptyString(payload.error)
  const guardrailName = nonEmptyString(payload.guardrailName)
  const scope = buildScope(event)
  switch (event.eventType ?? '') {
    case 'run.started':
      uiHost.pushEntry(withScope({ kind: 'run.started', harnessName: nonEmptyString(payload.harnessName) ?? 'ludd' }, scope))
      break
    case 'run.resumed':
      uiHost.pushEntry(withScope({
        kind: 'run.resumed',
        harnessName: nonEmptyString(payload.harnessName),
      }, scope))
      break
    case 'run.passed':
      uiHost.setActivity(undefined)
      uiHost.pushEntry(withScope({ kind: 'run.passed' }, scope))
      break
    case 'run.failed':
      uiHost.setActivity(undefined)
      uiHost.pushEntry(withScope({ kind: 'run.failed', error }, scope))
      break
    case 'step.started':
      uiHost.pushEntry(withScope({ kind: 'step.started', stepId }, scope))
      uiHost.setActivity(`${stepId} · running...`)
      break
    case 'step.passed':
      uiHost.setActivity(undefined)
      uiHost.pushEntry(withScope({ kind: 'step.passed', stepId }, scope))
      break
    case 'step.skipped':
      uiHost.setActivity(undefined)
      uiHost.pushEntry(withScope({ kind: 'step.skipped', stepId }, scope))
      break
    case 'step.failed':
      uiHost.setActivity(undefined)
      uiHost.pushEntry(withScope({ kind: 'step.failed', stepId, error }, scope))
      break
    case 'step.retry':
      uiHost.pushEntry(withScope({
        kind: 'step.retry',
        stepId,
        attempt: typeof payload.attempt === 'number'
          ? payload.attempt
          : undefined,
      }, buildScope(event, 'run')))
      uiHost.setActivity(`${stepId} · retrying...`)
      break
    case 'guardrail.started':
      uiHost.onGuardrailStarted?.(scope ?? { stepId })
      uiHost.pushEntry(withScope({
        kind: 'guardrail.started',
        ...(guardrailName !== undefined
          ? { name: guardrailName }
          : {}),
      }, scope))
      uiHost.setActivity(
        guardrailName !== undefined
          ? `${stepId} · running guardrail ${guardrailName}...`
          : `${stepId} · running guardrail...`,
      )
      break
    case 'guardrail.passed':
      uiHost.pushEntry(withScope({
        kind: 'guardrail.passed',
        ...(guardrailName !== undefined
          ? { name: guardrailName }
          : {}),
        ...extractGuardrailOutput(payload.verdict),
      }, scope))
      break
    case 'guardrail.skipped':
      uiHost.pushEntry(withScope({
        kind: 'guardrail.skipped',
        ...(guardrailName !== undefined
          ? { name: guardrailName }
          : {}),
        ...extractGuardrailOutput(payload.verdict),
      }, scope))
      break
    case 'guardrail.failed':
      uiHost.pushEntry(withScope({
        kind: 'guardrail.failed',
        ...(guardrailName !== undefined
          ? { name: guardrailName }
          : {}),
        ...extractGuardrailOutput(payload.verdict),
      }, scope))
      break
    case 'gate.waiting':
      uiHost.setActivity(undefined)
      uiHost.setGateWaiting?.(true, scope)
      break
    case 'gate.resolved':
      uiHost.setGateWaiting?.(false, scope)
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
  private readonly uiThoughtBuffers = new Map<string, string>()
  private readonly textSegmentSeq = new Map<string, number>()
  private readonly thoughtSegmentSeq = new Map<string, number>()
  private readonly sessionScopes = new Map<string, UiLogScope>()
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

  private flushUiTextBuffer(sessionId: string, uiHost: RunUiHost): void {
    const raw = this.uiTextBuffers.get(sessionId)
    this.uiTextBuffers.delete(sessionId)
    const buffered = raw?.trim()
    if (buffered !== undefined && buffered.length > 0) {
      const scope = this.sessionScopes.get(sessionId)
      if (uiHost.upsertEntry !== undefined) {
        const seq = this.textSegmentSeq.get(sessionId) ?? 0
        uiHost.upsertEntry(`text:${sessionId}:${seq}`, withScope({ kind: 'agent.text', text: buffered }, scope))
        this.textSegmentSeq.set(sessionId, seq + 1)
      }
      else {
        uiHost.pushEntry(withScope({ kind: 'agent.text', text: buffered }, scope))
      }
    }
  }

  private flushUiThoughtBuffer(sessionId: string, uiHost: RunUiHost): void {
    const raw = this.uiThoughtBuffers.get(sessionId)
    this.uiThoughtBuffers.delete(sessionId)
    const buffered = raw?.trim()
    if (buffered !== undefined && buffered.length > 0) {
      const scope = this.sessionScopes.get(sessionId)
      if (uiHost.upsertEntry !== undefined) {
        const seq = this.thoughtSegmentSeq.get(sessionId) ?? 0
        uiHost.upsertEntry(`thought:${sessionId}:${seq}`, withScope({ kind: 'agent.thought', text: buffered, streaming: false }, scope))
        this.thoughtSegmentSeq.set(sessionId, seq + 1)
      }
      else {
        uiHost.pushEntry(withScope({ kind: 'agent.thought', text: buffered }, scope))
      }
    }
  }

  private flushUiBuffer(sessionId: string, uiHost: RunUiHost): void {
    this.flushUiThoughtBuffer(sessionId, uiHost)
    this.flushUiTextBuffer(sessionId, uiHost)
  }

  private flushAllUiBuffers(): void {
    const uiHost = this.activeUiHost()
    if (!uiHost)
      return
    const sessionIds = new Set([
      ...this.uiThoughtBuffers.keys(),
      ...this.uiTextBuffers.keys(),
    ])
    for (const id of sessionIds) {
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
    const existingScope = this.sessionScopes.get(sessionId)
    const eventScope = buildScope(event, existingScope?.phase ?? 'run')
    const mergedScope: UiLogScope | undefined = existingScope || eventScope
      ? {
          ...existingScope,
          ...eventScope,
        }
      : undefined
    if (mergedScope !== undefined) {
      this.sessionScopes.set(sessionId, mergedScope)
    }
    const stepId = mergedScope?.stepId ?? nonEmptyString(event.stepId) ?? 'step'
    if (event.eventType === 'turn.started') {
      this.streamedTextSessions.delete(sessionId)
      this.uiTextBuffers.delete(sessionId)
      this.uiThoughtBuffers.delete(sessionId)
      uiHost.setActivity(`${stepId} · thinking...`)
      return
    }
    if (event.eventType === 'thought' && typeof payload.text === 'string' && payload.text.length > 0) {
      this.flushUiTextBuffer(sessionId, uiHost)
      const nextText = `${this.uiThoughtBuffers.get(sessionId) ?? ''}${payload.text}`
      this.uiThoughtBuffers.set(sessionId, nextText)
      uiHost.setActivity(`${stepId} · thinking...`)
      if (uiHost.upsertEntry !== undefined && nextText.trim().length > 0) {
        const seq = this.thoughtSegmentSeq.get(sessionId) ?? 0
        uiHost.upsertEntry(
          `thought:${sessionId}:${seq}`,
          withScope({
            kind: 'agent.thought',
            text: nextText.trim(),
            streaming: true,
          }, mergedScope),
        )
      }
      return
    }
    if (event.eventType === 'message_chunk' && typeof payload.text === 'string' && payload.text.length > 0) {
      this.flushUiThoughtBuffer(sessionId, uiHost)
      this.streamedTextSessions.add(sessionId)
      const nextText = `${this.uiTextBuffers.get(sessionId) ?? ''}${payload.text}`
      this.uiTextBuffers.set(sessionId, nextText)
      if (uiHost.upsertEntry !== undefined && nextText.trim().length > 0) {
        const seq = this.textSegmentSeq.get(sessionId) ?? 0
        uiHost.upsertEntry(
          `text:${sessionId}:${seq}`,
          withScope({
            kind: 'agent.text',
            text: nextText.trim(),
          }, mergedScope),
        )
      }
      return
    }
    if (event.eventType === 'tool_call') {
      const toolName = nonEmptyString(payload.toolName) ?? 'tool'
      if (toolName === 'ask_user')
        return
      this.flushUiBuffer(sessionId, uiHost)
      if (payload.phase === 'start') {
        uiHost.pushEntry(withScope({
          kind: 'tool.start',
          toolName,
          argsSummary: formatToolArgsSummary(payload.args),
        }, mergedScope))
        uiHost.setActivity(`${stepId} · running ${toolName}...`)
      }
      else if (payload.phase === 'end') {
        if (payload.isError === true)
          uiHost.pushEntry(withScope({ kind: 'tool.error', toolName }, mergedScope))
        uiHost.setActivity(`${stepId} · thinking...`)
      }
      return
    }
    if (event.eventType === 'turn.completed') {
      this.flushUiBuffer(sessionId, uiHost)
      if (payload.output !== undefined && payload.output !== '') {
        if (typeof payload.output === 'string' && this.streamedTextSessions.has(sessionId))
          return
        uiHost.pushEntry(withScope({
          kind: 'agent.output',
          output: formatOutputValue(payload.output),
        }, mergedScope))
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
        if (typeof sessionId === 'string') {
          this.streams.add(sessionId)
          const linkedScope = buildScope(event, 'run')
          if (linkedScope !== undefined) {
            this.sessionScopes.set(sessionId, linkedScope)
          }
        }
      }
      catch { /* Ignore incomplete JSONL records. */ }
    })
    for (const id of this.streams) {
      this.readLines(path.join(this.runDir, 'streams', `${id}.jsonl`), line => this.handleStreamLine(id, line))
    }
  }
}
