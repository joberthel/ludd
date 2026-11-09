import fs from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RunAlreadyActiveError } from '../errors/run-already-active-error.js'
import { CONTROL_SOCKET_NAME } from '../ipc/socket-path.js'
import {
  acquireRunPidLock,
  isProcessAlive,
  releaseRunPidLock,
  RUNNER_PID_FILE,
} from './pid-lock.js'

describe('isProcessAlive', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns false for non-integer numbers or non-positive pids', () => {
    expect(isProcessAlive(Number.NaN)).toBe(false)
    expect(isProcessAlive(3.14)).toBe(false)
    expect(isProcessAlive(0)).toBe(false)
    expect(isProcessAlive(-1)).toBe(false)
  })

  it('returns true for current live process', () => {
    expect(isProcessAlive(process.pid)).toBe(true)
  })

  it('returns false when process.kill throws ESRCH for dead process', () => {
    expect(isProcessAlive(999999)).toBe(false)
  })

  it('returns true when process.kill throws EPERM error', () => {
    const error = new Error('Operation not permitted') as NodeJS.ErrnoException
    error.code = 'EPERM'
    vi.spyOn(process, 'kill').mockImplementation(() => {
      throw error
    })

    expect(isProcessAlive(12345)).toBe(true)
  })

  it('returns false when process.kill throws generic non-EPERM error', () => {
    const error = new Error('Invalid argument') as NodeJS.ErrnoException
    error.code = 'EINVAL'
    vi.spyOn(process, 'kill').mockImplementation(() => {
      throw error
    })
    expect(isProcessAlive(12345)).toBe(false)

    vi.spyOn(process, 'kill').mockImplementation(() => {
      throw new Error('arbitrary failure')
    })
    expect(isProcessAlive(12345)).toBe(false)
  })
})

describe('acquireRunPidLock creation and lock contention', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-pid-lock-test-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('creates runDir and writes default process.pid when file does not exist', () => {
    const runDir = path.join(tempDir, 'new-run')
    acquireRunPidLock(runDir, 'run-1')

    const pidFile = path.join(runDir, RUNNER_PID_FILE)
    expect(fs.existsSync(pidFile)).toBe(true)
    expect(fs.readFileSync(pidFile, 'utf-8')).toBe(`${process.pid}\n`)
  })

  it('writes explicitly provided currentPid when acquiring lock', () => {
    const runDir = path.join(tempDir, 'explicit-pid')
    acquireRunPidLock(runDir, 'run-2', 4242)

    const pidFile = path.join(runDir, RUNNER_PID_FILE)
    expect(fs.readFileSync(pidFile, 'utf-8')).toBe('4242\n')
  })

  it('throws RunAlreadyActiveError when existing runner.pid is alive and preserves control.sock', () => {
    const runDir = path.join(tempDir, 'active-run')
    fs.mkdirSync(runDir, { recursive: true })
    const pidFile = path.join(runDir, RUNNER_PID_FILE)
    const sockFile = path.join(runDir, CONTROL_SOCKET_NAME)
    fs.writeFileSync(pidFile, `${process.pid}\n`, 'utf-8')
    fs.writeFileSync(sockFile, 'fake-socket-content', 'utf-8')

    expect(() => acquireRunPidLock(runDir, 'active-run', 9999)).toThrow(RunAlreadyActiveError)
    expect(fs.readFileSync(pidFile, 'utf-8')).toBe(`${process.pid}\n`)
    expect(fs.existsSync(sockFile)).toBe(true)
  })
})

describe('acquireRunPidLock stale pid and socket recovery', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-pid-lock-test-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('overwrites stale runner.pid and unlinks stale control.sock when existing pid is dead', () => {
    const runDir = path.join(tempDir, 'dead-run')
    fs.mkdirSync(runDir, { recursive: true })
    const pidFile = path.join(runDir, RUNNER_PID_FILE)
    const sockFile = path.join(runDir, CONTROL_SOCKET_NAME)
    fs.writeFileSync(pidFile, '999999\n', 'utf-8')
    fs.writeFileSync(sockFile, 'stale-socket', 'utf-8')

    acquireRunPidLock(runDir, 'dead-run', 7777)
    expect(fs.readFileSync(pidFile, 'utf-8')).toBe('7777\n')
    expect(fs.existsSync(sockFile)).toBe(false)
  })

  it('overwrites stale runner.pid when existing pid file contains corrupt content', () => {
    const runDir = path.join(tempDir, 'corrupt-run')
    fs.mkdirSync(runDir, { recursive: true })
    const pidFile = path.join(runDir, RUNNER_PID_FILE)
    fs.writeFileSync(pidFile, 'not-a-valid-pid\n', 'utf-8')

    acquireRunPidLock(runDir, 'corrupt-run', 8888)
    expect(fs.readFileSync(pidFile, 'utf-8')).toBe('8888\n')
  })

  it('unlinks stale control.sock when runner.pid does not exist', () => {
    const runDir = path.join(tempDir, 'no-pid-run')
    fs.mkdirSync(runDir, { recursive: true })
    const sockFile = path.join(runDir, CONTROL_SOCKET_NAME)
    fs.writeFileSync(sockFile, 'orphaned-socket', 'utf-8')

    acquireRunPidLock(runDir, 'no-pid-run', 6666)
    const pidFile = path.join(runDir, RUNNER_PID_FILE)
    expect(fs.readFileSync(pidFile, 'utf-8')).toBe('6666\n')
    expect(fs.existsSync(sockFile)).toBe(false)
  })
})

describe('releaseRunPidLock', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-pid-release-test-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('releases existing runner.pid without error and handles missing file', () => {
    const runDir = path.join(tempDir, 'release-run')
    acquireRunPidLock(runDir, 'release-run', 1234)
    const pidFile = path.join(runDir, RUNNER_PID_FILE)
    expect(fs.existsSync(pidFile)).toBe(true)

    releaseRunPidLock(runDir)
    expect(fs.existsSync(pidFile)).toBe(false)

    expect(() => releaseRunPidLock(runDir)).not.toThrow()
  })
})
