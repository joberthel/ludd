import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  createDefaultHostEnvironment,
  execHostCommand,
  killProcessTree,
  resolveStepEnvironment,
} from '../environment-manager.js'

describe('execHostCommand standard execution', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'exec-host-test-'))

  it('executes string command via shell and captures stdout', async () => {
    const result = await execHostCommand(tmpDir, 'node -e "console.log(\'hello string\')"')
    expect(result.exitCode).toBe(0)
    expect(result.stdout.trim()).toBe('hello string')
    expect(result.timedOut).toBe(false)
  })

  it('executes array command directly with zero shell interpolation', async () => {
    const cmd = [
      'node',
      '-e',
      'console.log(process.argv.slice(1).join(" "))',
      'arg1',
      'arg2',
    ]
    const result = await execHostCommand(tmpDir, cmd)
    expect(result.exitCode).toBe(0)
    expect(result.stdout.trim()).toBe('arg1 arg2')
    expect(result.timedOut).toBe(false)
  })

  it('captures stderr and non-zero exit code', async () => {
    const result = await execHostCommand(tmpDir, ['node', '-e', 'console.error("boom"); process.exit(42)'])
    expect(result.exitCode).toBe(42)
    expect(result.stderr.trim()).toBe('boom')
    expect(result.timedOut).toBe(false)
  })

  it('injects environment variables into child process', async () => {
    const result = await execHostCommand(tmpDir, ['node', '-e', 'console.log(process.env.TEST_VAR)'], {
      env: { TEST_VAR: 'custom-val' },
    })
    expect(result.stdout.trim()).toBe('custom-val')
  })

  it('respects cwd option and handles empty cwd fallback', async () => {
    const subDir = path.join(tmpDir, 'sub')
    fs.mkdirSync(subDir, { recursive: true })
    const result = await execHostCommand(tmpDir, ['node', '-e', 'console.log(process.cwd())'], {
      cwd: 'sub',
    })
    expect(result.stdout.trim()).toBe(fs.realpathSync(subDir))

    const defaultResult = await execHostCommand(tmpDir, ['node', '-e', 'console.log(process.cwd())'], {
      cwd: '   ',
    })
    expect(defaultResult.stdout.trim()).toBe(fs.realpathSync(tmpDir))
  })
})

describe('execHostCommand input validation and failures', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'exec-host-errors-'))

  it('throws on empty string command', async () => {
    await expect(execHostCommand(tmpDir, '   ')).rejects.toThrow('Command string must not be empty.')
  })

  it('throws on empty array command', async () => {
    await expect(execHostCommand(tmpDir, [])).rejects.toThrow('Command array must not be empty.')
  })

  it('throws on invalid command type', async () => {
    await expect(execHostCommand(tmpDir, 123 as any)).rejects.toThrow('Command must be a non-empty string or array of strings.')
  })

  it('rejects when binary does not exist, with and without timer', async () => {
    await expect(execHostCommand(tmpDir, ['non-existent-binary-12345'])).rejects.toThrow()
    await expect(execHostCommand(tmpDir, ['non-existent-binary-12345'], { timeoutMs: 5000 })).rejects.toThrow()
  })
})

describe('execHostCommand timeout and abort handling', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'exec-host-abort-'))

  it('handles timeout by killing process tree and resolving with timedOut true', async () => {
    const result = await execHostCommand(tmpDir, ['node', '-e', 'setInterval(() => {}, 1000)'], {
      timeoutMs: 100,
    })
    expect(result.timedOut).toBe(true)
    expect(result.exitCode).toBeNull()
  })

  it('rejects immediately when AbortSignal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort(new Error('Pre-aborted command'))
    await expect(
      execHostCommand(tmpDir, ['node', '-e', 'console.log("ok")'], { signal: controller.signal }),
    ).rejects.toThrow('Pre-aborted command')
  })

  it('aborts running command, kills process tree, and rejects', async () => {
    const controller = new AbortController()
    const execPromise = execHostCommand(
      tmpDir,
      ['node', '-e', 'setInterval(() => {}, 1000)'],
      { signal: controller.signal, timeoutMs: 10000 },
    )
    setTimeout(() => controller.abort('Process canceled by user'), 50)
    await expect(execPromise).rejects.toThrow('Process canceled by user')
  })

  it('rejects with default message when aborted without reason', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      execHostCommand(tmpDir, ['node', '-e', 'console.log("ok")'], { signal: controller.signal }),
    ).rejects.toThrow('This operation was aborted')

    const fakeSignal = { aborted: true, reason: undefined } as unknown as AbortSignal
    await expect(
      execHostCommand(tmpDir, ['node', '-e', 'console.log("ok")'], { signal: fakeSignal }),
    ).rejects.toThrow('Command aborted')
  })
})

describe('killProcessTree edge cases and graceful escalation', () => {
  it('safely handles undefined and zero pid', () => {
    expect(() => killProcessTree(undefined)).not.toThrow()
    expect(() => killProcessTree(0)).not.toThrow()
  })

  it('safely handles non-existent pid on unix and win32', () => {
    expect(() => killProcessTree(99999999)).not.toThrow()

    const originalPlatform = process.platform
    try {
      Object.defineProperty(process, 'platform', { value: 'win32' })
      expect(() => killProcessTree(99999999)).not.toThrow()
    }
    finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform })
    }
  })

  it('escalates to SIGKILL for processes that ignore SIGTERM', async () => {
    const child = spawn('node', ['-e', 'process.on("SIGTERM", () => {}); console.log("ready"); setInterval(() => {}, 1000)'], {
      detached: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    await new Promise((resolve) => {
      child.stdout?.once('data', resolve)
    })
    killProcessTree(child.pid, 20)
    await new Promise((resolve) => {
      child.on('close', resolve)
    })
  })
})

describe('createDefaultHostEnvironment', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'default-host-env-'))

  it('creates host environment conforming to ProvisionedEnvironment', async () => {
    const env = createDefaultHostEnvironment(tmpDir)
    expect(env.__kind).toBe('environment')
    expect(env.id).toBe('host')
    expect(env.type).toBe('host')
    expect(env.workingDir).toBe(path.resolve(tmpDir))

    expect(await env.ping()).toBe(true)
    await expect(env.teardown()).resolves.toBeUndefined()

    const execResult = await env.exec(['node', '-e', 'console.log("ok")'])
    expect(execResult.exitCode).toBe(0)
    expect(execResult.stdout.trim()).toBe('ok')
  })
})

describe('resolveStepEnvironment with defaultSignal', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'resolve-step-env-'))

  it('wraps custom environment exec with defaultSignal and options.signal override', async () => {
    const defaultCtrl = new AbortController()
    const customEnv = createDefaultHostEnvironment(dir)
    const execSpy = vi.spyOn(customEnv, 'exec')
    const ctx = {
      runId: 'env-step-run',
      environments: {},
      steps: {},
      step: { id: 'custom-step', output: undefined, attempt: 1 },
      matrix: undefined,
      artifacts: {} as any,
    }
    const resolved = await resolveStepEnvironment(
      {
        id: 'custom-step',
        environment: customEnv,
        run: async () => 'ok',
      },
      ctx,
      dir,
      undefined,
      undefined,
      defaultCtrl.signal,
    )
    await resolved.exec(['node', '-e', 'console.log("wrapped")'])
    expect(execSpy).toHaveBeenCalledWith(
      ['node', '-e', 'console.log("wrapped")'],
      expect.objectContaining({ signal: defaultCtrl.signal }),
    )
    const overrideCtrl = new AbortController()
    await resolved.exec(['node', '-e', 'console.log("override")'], { signal: overrideCtrl.signal })
    expect(execSpy).toHaveBeenCalledWith(
      ['node', '-e', 'console.log("override")'],
      expect.objectContaining({ signal: overrideCtrl.signal }),
    )
  })
})
