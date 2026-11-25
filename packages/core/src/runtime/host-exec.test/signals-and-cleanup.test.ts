import { spawn as nodeSpawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { afterAll, describe, expect, it } from 'vitest'
import { killProcessTree, spawn } from '../host-exec.js'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'host-exec-signals-'))

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('host spawn timeout handling', () => {
  it('completes normally before positive timeoutMs and ignores non-positive or non-finite timeoutMs', async () => {
    for (const timeoutMs of [
      0,
      -50,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      5000,
    ]) {
      const res = await spawn({
        command: process.execPath,
        args: ['-e', 'console.log("fast")'],
        timeoutMs,
      })
      expect(res.exitCode).toBe(0)
      expect(res.timedOut).toBe(false)
      expect(res.stdout.trim()).toBe('fast')
    }
  })

  it('terminates process tree on timeout and waits for close before resolving timedOut true', async () => {
    const res = await spawn({
      command: process.execPath,
      args: ['-e', 'setInterval(() => {}, 1000)'],
      timeoutMs: 80,
    })
    expect(res.timedOut).toBe(true)
    expect(res.exitCode).toBeNull()
    expect(res.signal).toBeNull()
  })

  it('ignores duplicate abort while already terminating from timeout', async () => {
    const ctrl = new AbortController()
    const res = await spawn({
      command: process.execPath,
      args: [
        '-e',
        'process.on("SIGTERM", () => { console.log("term-ignored"); }); console.log("ready"); setInterval(() => {}, 1000);',
      ],
      timeoutMs: 60,
      signal: ctrl.signal,
      onStdout: (chunk) => {
        if (chunk.includes('term-ignored')) {
          ctrl.abort(new Error('late-abort'))
        }
      },
    })
    expect(res.timedOut).toBe(true)
  })
})

describe('host spawn AbortSignal handling and safety timer', () => {
  it('rejects immediately on pre-aborted AbortSignal reasons', async () => {
    const ctrlErr = new AbortController()
    ctrlErr.abort(new Error('pre-aborted-error'))
    await expect(spawn({
      command: process.execPath,
      args: ['-e', 'console.log("ok")'],
      signal: ctrlErr.signal,
    })).rejects.toThrow('pre-aborted-error')

    const fakeSignal = { aborted: true, reason: undefined } as unknown as AbortSignal
    await expect(spawn({
      command: process.execPath,
      args: ['-e', 'console.log("ok")'],
      signal: fakeSignal,
    })).rejects.toThrow('Command aborted')
  })

  it('waits for child and grandchild close on abort both with and without timeout', async () => {
    const ctrl = new AbortController()
    const childPidFile = path.join(tmpDir, 'grandchild.pid')
    try {
      const promise = spawn({
        command: process.execPath,
        args: [
          '-e',
          `const fs = require('node:fs'); const { spawn } = require('node:child_process'); const gc = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'inherit' }); fs.writeFileSync(${JSON.stringify(childPidFile)}, String(gc.pid)); console.log('ready'); setInterval(() => {}, 1000);`,
        ],
        signal: ctrl.signal,
        onStdout: (chunk) => {
          if (chunk.includes('ready')) {
            ctrl.abort('cancelled-without-timer')
          }
        },
      })
      await expect(promise).rejects.toThrow('cancelled-without-timer')

      const grandchildPid = Number.parseInt(fs.readFileSync(childPidFile, 'utf8'), 10)
      expect(() => process.kill(grandchildPid, 0)).toThrow()
    }
    finally {
      fs.rmSync(childPidFile, { force: true })
    }

    const ctrlWithTimer = new AbortController()
    const withTimerPromise = spawn({
      command: process.execPath,
      args: ['-e', 'setInterval(() => {}, 1000)'],
      signal: ctrlWithTimer.signal,
      timeoutMs: 10_000,
    })
    setTimeout(() => ctrlWithTimer.abort(new Error('cancelled-with-timer')), 50)
    await expect(withTimerPromise).rejects.toThrow('cancelled-with-timer')
  })

  it('settles via safety timer if an escaped detached descendant holds stdio open', async () => {
    const escapedPidFile = path.join(tmpDir, 'escaped.pid')
    const ctrl = new AbortController()
    try {
      const promise = spawn({
        command: process.execPath,
        args: [
          '-e',
          `const fs = require('node:fs'); const { spawn } = require('node:child_process'); const d = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: ['ignore', 1, 2] }); fs.writeFileSync(${JSON.stringify(escapedPidFile)}, String(d.pid)); console.log('ready'); setInterval(() => {}, 1000);`,
        ],
        signal: ctrl.signal,
        onStdout: (chunk) => {
          if (chunk.includes('ready')) {
            ctrl.abort(new Error('aborted-with-escaped-child'))
          }
        },
      })
      await expect(promise).rejects.toThrow('aborted-with-escaped-child')
    }
    finally {
      if (fs.existsSync(escapedPidFile)) {
        const pid = Number.parseInt(fs.readFileSync(escapedPidFile, 'utf8'), 10)
        try {
          process.kill(-pid, 'SIGKILL')
        }
        catch {
          // Already exited
        }
        fs.rmSync(escapedPidFile, { force: true })
      }
    }
  })
})

describe('killProcessTree guards and escalation', () => {
  it('ignores undefined, zero, negative, fractional, NaN, and dead PIDs on unix and win32', () => {
    for (const invalidPid of [
      undefined,
      0,
      -1,
      -999,
      Number.NaN,
      1.5,
      99_999_999,
    ]) {
      expect(() => killProcessTree(invalidPid)).not.toThrow()
    }

    const originalPlatform = process.platform
    try {
      Object.defineProperty(process, 'platform', { value: 'win32' })
      expect(() => killProcessTree(99_999_999)).not.toThrow()
    }
    finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform })
    }
  })

  it('handles graceful SIGTERM exit and SIGKILL escalation', async () => {
    const graceful = nodeSpawn(process.execPath, ['-e', 'console.log("ready"); setInterval(() => {}, 1000)'], {
      detached: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    await new Promise((resolve) => {
      graceful.stdout.once('data', resolve)
    })
    killProcessTree(graceful.pid, 20)
    await new Promise((resolve) => {
      graceful.on('close', resolve)
    })
    await new Promise(resolve => setTimeout(resolve, 35))

    const stubborn = nodeSpawn(
      process.execPath,
      ['-e', 'process.on("SIGTERM", () => {}); console.log("ready"); setInterval(() => {}, 1000)'],
      {
        detached: true,
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    )
    await new Promise((resolve) => {
      stubborn.stdout.once('data', resolve)
    })
    killProcessTree(stubborn.pid, 20)
    await new Promise((resolve) => {
      stubborn.on('close', resolve)
    })
  })
})
