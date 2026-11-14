import type net from 'node:net'
import { Buffer } from 'node:buffer'
import { StringDecoder } from 'node:string_decoder'

export const MAX_IPC_LINE_BYTES = 1024 * 1024 // 1 MiB

/**
 * Attaches a newline-delimited UTF-8 frame reader to a `net.Socket`.
 * Uses `StringDecoder` to avoid corrupting multi-byte UTF-8 characters split
 * across chunks, and destroys the socket if the buffered line exceeds `maxLineBytes`.
 */
export function attachSocketLineBuffer(
  socket: net.Socket,
  onLine: (line: string) => void,
  maxLineBytes: number = MAX_IPC_LINE_BYTES,
): void {
  const decoder = new StringDecoder('utf8')
  let buffer = ''

  socket.on('data', (chunk: Buffer) => {
    buffer += decoder.write(chunk)

    let newlineIndex = buffer.indexOf('\n')
    while (newlineIndex !== -1) {
      const line = buffer.slice(0, newlineIndex).trim()
      buffer = buffer.slice(newlineIndex + 1)
      if (line.length > 0) {
        onLine(line)
      }
      newlineIndex = buffer.indexOf('\n')
    }

    if (Buffer.byteLength(buffer, 'utf8') > maxLineBytes) {
      buffer = ''
      socket.destroy(new Error(`IPC line buffer exceeded ${maxLineBytes} bytes`))
    }
  })

  socket.on('end', () => {
    const trailing = (buffer + decoder.end()).trim()
    buffer = ''
    if (trailing.length > 0 && Buffer.byteLength(trailing, 'utf8') <= maxLineBytes) {
      onLine(trailing)
    }
  })
}
