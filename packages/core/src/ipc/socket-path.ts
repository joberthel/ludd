import { createHash } from 'node:crypto'
import path from 'node:path'
import process from 'node:process'

export const CONTROL_SOCKET_NAME = 'control.sock'
export const MAX_POSIX_SOCKET_PATH_LENGTH = 100

export function getControlSocketPath(
  runDir: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const resolved = path.resolve(runDir)
  const hash = createHash('sha256').update(resolved).digest('hex')

  if (platform === 'win32') {
    return `\\\\.\\pipe\\ludd-${hash}`
  }

  const standardPath = path.join(runDir, CONTROL_SOCKET_NAME)
  if (path.resolve(standardPath).length >= MAX_POSIX_SOCKET_PATH_LENGTH) {
    return path.join('/tmp', `ludd-${hash.slice(0, 32)}.sock`)
  }

  return standardPath
}
