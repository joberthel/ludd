import type { Server } from 'node:net'
import net from 'node:net'

async function listenEphemeral(): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    let onListening: () => void
    const onError = (err: Error): void => {
      server.removeListener('listening', onListening)
      reject(err)
    }
    onListening = (): void => {
      server.removeListener('error', onError)
      resolve(server)
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(0, '127.0.0.1')
  })
}

async function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve())
  })
}

export async function allocateEphemeralPorts(
  names: readonly string[],
): Promise<Record<string, number>> {
  if (names === undefined || names === null || names.length === 0) {
    return {}
  }

  const uniqueNames = Array.from(new Set(names))
  const servers: Server[] = []

  try {
    const result: Record<string, number> = {}
    for (const name of uniqueNames) {
      const server = await listenEphemeral()
      servers.push(server)
      const address = server.address()
      if (address === null || address === undefined || typeof address === 'string') {
        throw new Error(`Failed to retrieve address for ephemeral port: ${name}`)
      }
      result[name] = address.port
    }
    return result
  }
  finally {
    await Promise.all(servers.map(closeServer))
  }
}
