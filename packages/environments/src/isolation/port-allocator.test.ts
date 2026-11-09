import net from 'node:net'
import { describe, expect, it, vi } from 'vitest'
import { allocateEphemeralPorts } from './port-allocator.js'

describe('allocateEphemeralPorts basic allocation', () => {
  it('returns empty object when names array is empty or undefined', async () => {
    expect(await allocateEphemeralPorts([])).toEqual({})
    expect(await allocateEphemeralPorts(undefined as any)).toEqual({})
  })

  it('allocates valid ephemeral port (> 1024) and releases handle afterwards', async () => {
    const ports = await allocateEphemeralPorts(['APP_PORT'])
    expect(typeof ports.APP_PORT).toBe('number')
    expect(ports.APP_PORT).toBeGreaterThan(1024)

    // Verify port was released and can be bound again
    const verifyServer = net.createServer()
    await new Promise<void>((resolve, reject) => {
      verifyServer.once('error', reject)
      verifyServer.listen(ports.APP_PORT, '127.0.0.1', () => resolve())
    })
    await new Promise<void>((resolve) => {
      verifyServer.close(() => resolve())
    })
  })

  it('allocates distinct ports for multiple port names in a single batch', async () => {
    const ports = await allocateEphemeralPorts(['PORT_A', 'PORT_B', 'PORT_C'])
    expect(Object.keys(ports)).toHaveLength(3)
    expect(ports.PORT_A).toBeGreaterThan(1024)
    expect(ports.PORT_B).toBeGreaterThan(1024)
    expect(ports.PORT_C).toBeGreaterThan(1024)

    expect(ports.PORT_A).not.toBe(ports.PORT_B)
    expect(ports.PORT_B).not.toBe(ports.PORT_C)
    expect(ports.PORT_A).not.toBe(ports.PORT_C)
  })

  it('deduplicates duplicate port names in batch', async () => {
    const ports = await allocateEphemeralPorts(['DUP_PORT', 'DUP_PORT'])
    expect(Object.keys(ports)).toEqual(['DUP_PORT'])
    expect(ports.DUP_PORT).toBeGreaterThan(1024)
  })
})

describe('allocateEphemeralPorts listen error handling', () => {
  it('propagates error and closes open servers when server fails to listen', async () => {
    const originalCreateServer = net.createServer
    let callCount = 0

    vi.spyOn(net, 'createServer').mockImplementation(() => {
      callCount++
      if (callCount === 2) {
        const errorServer = originalCreateServer()
        // Override listen to trigger error event
        errorServer.listen = (() => {
          process.nextTick(() => {
            errorServer.emit('error', new Error('Simulated socket bind failure'))
          })
          return errorServer
        }) as any
        return errorServer
      }
      return originalCreateServer()
    })

    await expect(allocateEphemeralPorts(['PORT_1', 'PORT_2'])).rejects.toThrow(
      'Simulated socket bind failure',
    )

    vi.restoreAllMocks()
  })
})

describe('allocateEphemeralPorts address validation', () => {
  it('throws descriptive error if server address is null or string', async () => {
    const originalCreateServer = net.createServer

    vi.spyOn(net, 'createServer').mockImplementation(() => {
      const server = originalCreateServer()
      const originalListen = server.listen.bind(server)
      server.listen = ((...args: any[]) => {
        vi.spyOn(server, 'address').mockReturnValue(null)
        return originalListen(...args)
      }) as any
      return server
    })

    await expect(allocateEphemeralPorts(['NULL_ADDR'])).rejects.toThrow(
      'Failed to retrieve address for ephemeral port: NULL_ADDR',
    )

    vi.restoreAllMocks()
  })

  it('throws descriptive error if server address is a string', async () => {
    const originalCreateServer = net.createServer

    vi.spyOn(net, 'createServer').mockImplementation(() => {
      const server = originalCreateServer()
      const originalListen = server.listen.bind(server)
      server.listen = ((...args: any[]) => {
        vi.spyOn(server, 'address').mockReturnValue('/tmp/socket.sock')
        return originalListen(...args)
      }) as any
      return server
    })

    await expect(allocateEphemeralPorts(['STR_ADDR'])).rejects.toThrow(
      'Failed to retrieve address for ephemeral port: STR_ADDR',
    )

    vi.restoreAllMocks()
  })
})
