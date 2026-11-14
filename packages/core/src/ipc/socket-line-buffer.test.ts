import type net from 'node:net'
import { Buffer } from 'node:buffer'
import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import { attachSocketLineBuffer } from './socket-line-buffer.js'

class MockSocket extends EventEmitter {
  destroyed = false
  destroyError: Error | undefined

  destroy(err?: Error): this {
    this.destroyed = true
    this.destroyError = err
    return this
  }
}

describe('attachSocketLineBuffer', () => {
  it('decodes multi-byte UTF-8 characters split across chunk boundaries', () => {
    const socket = new MockSocket()
    const lines: string[] = []
    attachSocketLineBuffer(socket as unknown as net.Socket, (line) => {
      lines.push(line)
    })

    const payload = Buffer.from('{"text":"hello 🚀 world"}\n', 'utf8')
    const rocketIndex = payload.indexOf(Buffer.from('🚀', 'utf8'))
    // Split right in the middle of the 4-byte UTF-8 sequence for 🚀
    const chunk1 = payload.subarray(0, rocketIndex + 2)
    const chunk2 = payload.subarray(rocketIndex + 2)

    socket.emit('data', chunk1)
    socket.emit('data', chunk2)

    expect(lines).toEqual(['{"text":"hello 🚀 world"}'])
    expect(lines[0]).not.toContain('\uFFFD')
  })

  it('destroys the socket when buffered line exceeds maxLineBytes', () => {
    const socket = new MockSocket()
    const lines: string[] = []
    attachSocketLineBuffer(socket as unknown as net.Socket, (line) => {
      lines.push(line)
    }, 16)

    socket.emit('data', Buffer.from('1234567890', 'utf8'))
    expect(socket.destroyed).toBe(false)

    socket.emit('data', Buffer.from('1234567890', 'utf8'))
    expect(socket.destroyed).toBe(true)
    expect(socket.destroyError?.message).toContain('16 bytes')
    expect(lines).toEqual([])
  })

  it('flushes a trailing partial line on socket end and skips blank lines', () => {
    const socket = new MockSocket()
    const lines: string[] = []
    attachSocketLineBuffer(socket as unknown as net.Socket, (line) => {
      lines.push(line)
    })

    socket.emit('data', Buffer.from('\nfirst\n   \ntrailing', 'utf8'))
    socket.emit('end')

    expect(lines).toEqual(['first', 'trailing'])
  })
})
