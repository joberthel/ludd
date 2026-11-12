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
      this.offsets.set(file, stat.size)
      for (const line of buffer.toString('utf8').split('\n').filter(Boolean)) callback(line)
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
        if (this.stream && event.eventType === 'agent.stream.linked' && typeof event.payload?.sessionId === 'string')
          this.streams.add(event.payload.sessionId)
      }
      catch { /* Ignore incomplete JSONL records. */ }
    })
    for (const id of this.streams) {
      this.readLines(path.join(this.runDir, 'streams', `${id}.jsonl`), line => console.log(line))
    }
  }
}
