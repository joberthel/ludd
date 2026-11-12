import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { setTimeout as delay } from 'node:timers/promises'
import { expect } from 'vitest'

export const cli = path.resolve('packages/cli/dist/bin.js')

export async function launch(args: string[], cwd: string, input?: string): Promise<{ code: number | null, stdout: string, stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', data => stdout += data)
    child.stderr.setEncoding('utf8').on('data', data => stderr += data)
    child.once('error', reject)
    child.once('close', code => resolve({ code, stdout, stderr }))
    child.stdin.end(input)
  })
}

export async function launchWithHumanReview(args: string[], cwd: string): Promise<{ code: number | null, stdout: string, stderr: string }> {
  const child = spawn(process.execPath, [cli, ...args], {
    cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8').on('data', data => stdout += data)
  child.stderr.setEncoding('utf8').on('data', data => stderr += data)
  for (let gateNumber = 1; gateNumber <= 2; gateNumber++) {
    const actionPromptCount = () => stdout.split('Action [p]ass').length - 1
    await until(() => actionPromptCount() >= gateNumber || child.exitCode !== null, 10_000, stdout + stderr)
    child.stdin.write('p\n')
  }
  child.stdin.end()
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once('error', reject)
    child.once('close', resolve)
  })
  return { code, stdout, stderr }
}

export async function until(predicate: () => boolean, timeout = 10_000, details = ''): Promise<void> {
  const deadline = Date.now() + timeout
  while (!predicate() && Date.now() < deadline) await delay(50)
  expect(predicate(), `Timed out waiting for end-to-end CLI state. ${details}`).toBe(true)
}

export async function runJson(args: string[], cwd: string): Promise<any> {
  const result = await launch(args, cwd)
  expect(result.code, result.stderr).toBe(0)
  return JSON.parse(result.stdout)
}

export function readPid(dir: string, runId: string): number {
  return Number(fs.readFileSync(path.join(dir, `.harness/runs/${runId}/runner.pid`), 'utf8').trim())
}

export async function waitForProcessExit(pid: number): Promise<void> {
  await until(() => {
    try {
      process.kill(pid, 0)
      return false
    }
    catch {
      return true
    }
  })
}
