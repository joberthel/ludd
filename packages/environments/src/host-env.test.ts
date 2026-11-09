import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { describe, expect, it } from 'vitest'
import { hostEnv, killProcessTree } from './host-env.js'

describe('hostEnv initialization and lifecycle', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'host-env-init-'))

  it('defaults id to host and workingDir to cwd when options omitted', () => {
    const env = hostEnv()
    expect(env.id).toBe('host')
    expect(env.type).toBe('host')
    expect(env.__kind).toBe('environment')
    expect(env.workingDir).toBe(process.cwd())
  })

  it('respects custom trimmed id and resolved cwd', () => {
    const env = hostEnv({ id: '  my-env  ', cwd: tmpDir })
    expect(env.id).toBe('my-env')
    expect(env.workingDir).toBe(path.resolve(tmpDir))
  })

  it('verifies directory existence on ping and tears down cleanly', async () => {
    const env = hostEnv({ cwd: tmpDir })
    expect(await env.ping()).toBe(true)

    const deadEnv = hostEnv({
      cwd: path.join(tmpDir, 'does-not-exist'),
    })
    expect(await deadEnv.ping()).toBe(false)

    await expect(env.teardown()).resolves.toBeUndefined()
  })
})

describe('hostEnv command execution', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'host-env-exec-'))

  it('executes string commands via shell', async () => {
    const env = hostEnv({ cwd: tmpDir })
    const result = await env.exec('node -e "console.log(\'from string\')"')
    expect(result.exitCode).toBe(0)
    expect(result.stdout.trim()).toBe('from string')
    expect(result.timedOut).toBe(false)
  })

  it('executes argv array commands directly without shell expansion', async () => {
    const env = hostEnv({ cwd: tmpDir })
    const subshellArg = '$(echo pwned)'
    const cmd = [
      'node',
      '-e',
      'console.log(process.argv[1])',
      subshellArg,
    ]
    const result = await env.exec(cmd)
    expect(result.exitCode).toBe(0)
    expect(result.stdout.trim()).toBe('$(echo pwned)')
  })

  it('captures stderr and non-zero exit code', async () => {
    const env = hostEnv({ cwd: tmpDir })
    const result = await env.exec(['node', '-e', 'console.error("err msg"); process.exit(7)'])
    expect(result.exitCode).toBe(7)
    expect(result.stderr.trim()).toBe('err msg')
  })

  it('injects environment variables into child process', async () => {
    const env = hostEnv({ cwd: tmpDir })
    const result = await env.exec(['node', '-e', 'console.log(process.env.MCP_SERVER_URL, process.env.MCP_AUTH_TOKEN)'], {
      env: {
        MCP_SERVER_URL: 'http://localhost:3000',
        MCP_AUTH_TOKEN: 'secret-tok',
      },
    })
    expect(result.stdout.trim()).toBe('http://localhost:3000 secret-tok')
  })

  it('respects cwd option and whitespace fallback', async () => {
    const env = hostEnv({ cwd: tmpDir })
    const subDir = path.join(tmpDir, 'child')
    fs.mkdirSync(subDir, { recursive: true })

    const res1 = await env.exec(['node', '-e', 'console.log(process.cwd())'], { cwd: 'child' })
    expect(res1.stdout.trim()).toBe(fs.realpathSync(subDir))

    const res2 = await env.exec(['node', '-e', 'console.log(process.cwd())'], { cwd: '   ' })
    expect(res2.stdout.trim()).toBe(fs.realpathSync(tmpDir))
  })
})

describe('hostEnv validation and timeouts', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'host-env-val-'))

  it('throws on empty string command', async () => {
    const env = hostEnv({ cwd: tmpDir })
    await expect(env.exec('   ')).rejects.toThrow('Command string must not be empty.')
  })

  it('throws on empty array command', async () => {
    const env = hostEnv({ cwd: tmpDir })
    await expect(env.exec([])).rejects.toThrow('Command array must not be empty.')
  })

  it('throws on invalid command type', async () => {
    const env = hostEnv({ cwd: tmpDir })
    await expect(env.exec(null as any)).rejects.toThrow('Command must be a non-empty string or array of strings.')
  })

  it('rejects on missing binary with and without timeout timer', async () => {
    const env = hostEnv({ cwd: tmpDir })
    await expect(env.exec(['non-existent-binary-99999'])).rejects.toThrow()
    await expect(env.exec(['non-existent-binary-99999'], { timeoutMs: 5000 })).rejects.toThrow()
  })

  it('handles timeout by killing process tree and resolving with timedOut true', async () => {
    const env = hostEnv({ cwd: tmpDir })
    const result = await env.exec(['node', '-e', 'setInterval(() => {}, 1000)'], {
      timeoutMs: 100,
    })
    expect(result.timedOut).toBe(true)
    expect(result.exitCode).toBeNull()
  })
})

describe('hostEnv killProcessTree unit cases', () => {
  it('safely handles undefined, zero, and dead pid on unix and win32', () => {
    expect(() => killProcessTree(undefined)).not.toThrow()
    expect(() => killProcessTree(0)).not.toThrow()
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

  it('escalates to SIGKILL for processes ignoring SIGTERM', async () => {
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
