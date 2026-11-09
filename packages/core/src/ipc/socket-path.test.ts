import path from 'node:path'
import process from 'node:process'
import { describe, expect, it } from 'vitest'
import {
  CONTROL_SOCKET_NAME,
  getControlSocketPath,
  MAX_POSIX_SOCKET_PATH_LENGTH,
} from './socket-path.js'

describe('getControlSocketPath', () => {
  it('returns control.sock inside runDir for POSIX platforms when path is under limit', () => {
    const runDir = '/tmp/runs/r-1'
    expect(getControlSocketPath(runDir, 'linux')).toBe(path.join(runDir, CONTROL_SOCKET_NAME))
    expect(getControlSocketPath(runDir, 'darwin')).toBe(path.join(runDir, CONTROL_SOCKET_NAME))
  })

  it('uses default process.platform when platform argument is omitted', () => {
    const runDir = '/tmp/runs/r-2'
    const expected = process.platform === 'win32'
      ? getControlSocketPath(runDir, 'win32')
      : path.join(runDir, CONTROL_SOCKET_NAME)
    expect(getControlSocketPath(runDir)).toBe(expected)
  })

  it('falls back to hashed /tmp socket path when POSIX path exceeds length limit', () => {
    const deepDir = `/tmp/${'nested-folder/'.repeat(10)}runs/run-deep-id`
    const socketPath = getControlSocketPath(deepDir, 'darwin')

    expect(socketPath.startsWith('/tmp/ludd-')).toBe(true)
    expect(socketPath.endsWith('.sock')).toBe(true)
    expect(socketPath.length).toBeLessThan(MAX_POSIX_SOCKET_PATH_LENGTH)
  })

  it('returns Windows named pipe format for win32 platform', () => {
    const runDir = 'C:\\projects\\.harness\\runs\\run-456'
    const pipePath = getControlSocketPath(runDir, 'win32')

    expect(pipePath.startsWith('\\\\.\\pipe\\ludd-')).toBe(true)
    const hash = pipePath.replace('\\\\.\\pipe\\ludd-', '')
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('generates consistent hashes for identical directories and distinct hashes for different directories on win32', () => {
    const dirA = 'C:\\workspace\\run-a'
    const dirB = 'C:\\workspace\\run-b'

    const pipeA1 = getControlSocketPath(dirA, 'win32')
    const pipeA2 = getControlSocketPath(dirA, 'win32')
    const pipeB = getControlSocketPath(dirB, 'win32')

    expect(pipeA1).toBe(pipeA2)
    expect(pipeA1).not.toBe(pipeB)
  })

  it('resolves relative directory paths deterministically on win32', () => {
    const relative = './runs/run-rel'
    const pipePath = getControlSocketPath(relative, 'win32')
    const resolvedPipe = getControlSocketPath(path.resolve(relative), 'win32')

    expect(pipePath).toBe(resolvedPipe)
  })
})
