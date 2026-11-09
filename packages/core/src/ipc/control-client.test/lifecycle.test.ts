import type { ControlServer } from '../../types/ipc.js'
import type { RunStateSnapshot } from '../../types/state.js'
import { mkdtemp, rm } from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createControlClient } from '../control-client.js'
import { startControlServer } from '../control-server.js'

function createFakeSnapshot(): RunStateSnapshot {
  return {
    schemaVersion: 1,
    runId: 'client-test-run',
    harnessName: 'test-harness',
    status: 'running',
    activeStepId: 'step-1',
    steps: {},
    updatedAt: new Date().toISOString(),
  }
}

describe('control client closure state checks and connect errors', () => {
  let tempDir: string
  let server: ControlServer | undefined

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-client-test-'))
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    if (server) {
      await server.close()
      server = undefined
    }
    await rm(tempDir, { recursive: true, force: true })
  })

  it('rejects immediate request if client is already closed', async () => {
    server = await startControlServer(tempDir, {
      getStatus: () => createFakeSnapshot(),
    })
    const client = await createControlClient(tempDir)
    await client.close()
    await expect(client.close()).resolves.toBeUndefined()

    await expect(client.status()).rejects.toThrow('ControlClient is closed')
  })

  it('rejects connection promise if socket cannot connect', async () => {
    const nonExistentDir = path.join(tempDir, 'does-not-exist')
    await expect(createControlClient(nonExistentDir)).rejects.toThrow()
  })
})

describe('control client unexpected server closure', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-client-test-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('fails pending requests if server closes connection unexpectedly', async () => {
    const fakeServer = net.createServer((sock) => {
      sock.on('data', () => {
        sock.destroy()
      })
    })
    const socketPath = path.join(tempDir, 'control.sock')
    await new Promise<void>(resolve => fakeServer.listen(socketPath, resolve))

    const client = await createControlClient(tempDir)
    await expect(client.status()).rejects.toThrow('Control client socket closed')

    await client.close()
    await new Promise<void>(resolve => fakeServer.close(() => resolve()))
  })
})

describe('control client socket errors and write failures', () => {
  let tempDir: string
  let server: ControlServer | undefined

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-client-test-'))
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    if (server) {
      await server.close()
      server = undefined
    }
    await rm(tempDir, { recursive: true, force: true })
  })

  it('fails pending requests when client socket emits error', async () => {
    let clientSocket: net.Socket | undefined
    const origCreateConnection = net.createConnection
    vi.spyOn(net, 'createConnection').mockImplementationOnce((...args: unknown[]) => {
      const s = (origCreateConnection as (...a: unknown[]) => net.Socket).apply(net, args)
      clientSocket = s
      return s
    })

    server = await startControlServer(tempDir, {
      getStatus: async () => new Promise(() => {}),
    })

    const client = await createControlClient(tempDir)
    const reqPromise = client.status()
    clientSocket?.emit('error', new Error('Simulated client connection error'))

    await expect(reqPromise).rejects.toThrow('Simulated client connection error')
    await client.close()
  })

  it('rejects request if socket write fails with error', async () => {
    server = await startControlServer(tempDir, {
      getStatus: () => createFakeSnapshot(),
    })
    const client = await createControlClient(tempDir)

    vi.spyOn(net.Socket.prototype, 'write').mockImplementationOnce((...args: unknown[]) => {
      const cb = args.find(a => typeof a === 'function') as ((err?: Error) => void) | undefined
      if (cb) {
        cb(new Error('Simulated socket write failure'))
      }
      return false
    })

    await expect(client.request('test')).rejects.toThrow('Simulated socket write failure')
    await client.close()
  })
})
