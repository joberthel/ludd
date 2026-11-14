import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import path from 'node:path'

export class LiveRunTailer {
  private readonly offsets = new Map<string, number>()
  private timer: NodeJS.Timeout | undefined
  private readonly streams = new Set<string>()

  constructor(private readonly runDir: string, private readonly stream: boolean) {}

  start(): void {
    this.timer = setInterval(() => this.poll(), 100)
    this.timer.unref()
  }

  stop(): void {
    // Drain events written after the last interval tick so short runs still
    // show their final status in the foreground CLI.
    this.poll()
    if (this.timer)
      clearInterval(this.timer)
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

  private poll(): void {
    this.readLines(path.join(this.runDir, 'ledger.jsonl'), (line) => {
      try {
        const event = JSON.parse(line) as { eventType?: string, stepId?: string | null, payload?: Record<string, unknown> }
        const stepSuffix = event.stepId !== undefined && event.stepId !== null && event.stepId !== ''
          ? ` ${event.stepId}`
          : ''
        console.log(`[${event.eventType ?? 'event'}]${stepSuffix}`)
        if (!this.stream)
          return
        if (event.eventType !== 'agent.stream.linked')
          return
        const sessionId = event.payload?.sessionId
        if (typeof sessionId === 'string')
          this.streams.add(sessionId)
      }
      catch { /* Ignore incomplete JSONL records. */ }
    })
    for (const id of this.streams) {
      this.readLines(path.join(this.runDir, 'streams', `${id}.jsonl`), line => console.log(line))
    }
  }
}
