import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { RunAlreadyActiveError } from '../errors/run-already-active-error.js'
import { CONTROL_SOCKET_NAME, getControlSocketPath } from '../ipc/socket-path.js'

export const RUNNER_PID_FILE = 'runner.pid'

export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false
  }

  try {
    process.kill(pid, 0)
    return true
  }
  catch (error: unknown) {
    if (
      typeof error === 'object'
      && error !== null
      && (error as NodeJS.ErrnoException).code === 'EPERM'
    ) {
      return true
    }
    return false
  }
}

function removeStaleSockets(runDir: string): void {
  const primarySock = getControlSocketPath(runDir)
  const localSock = path.join(runDir, CONTROL_SOCKET_NAME)
  fs.rmSync(primarySock, { force: true })
  if (primarySock !== localSock) {
    fs.rmSync(localSock, { force: true })
  }
}

export function acquireRunPidLock(
  runDir: string,
  runId: string,
  currentPid: number = process.pid,
): void {
  fs.mkdirSync(runDir, { recursive: true })
  const pidPath = path.join(runDir, RUNNER_PID_FILE)

  if (fs.existsSync(pidPath)) {
    const content = fs.readFileSync(pidPath, 'utf-8')
    const existingPid = Number.parseInt(content.trim(), 10)
    if (isProcessAlive(existingPid)) {
      throw new RunAlreadyActiveError(runId, existingPid)
    }
    fs.rmSync(pidPath, { force: true })
    removeStaleSockets(runDir)
  }
  else {
    removeStaleSockets(runDir)
  }

  fs.writeFileSync(pidPath, `${currentPid}\n`, 'utf-8')
}

export function releaseRunPidLock(runDir: string): void {
  const pidPath = path.join(runDir, RUNNER_PID_FILE)
  fs.rmSync(pidPath, { force: true })
}
