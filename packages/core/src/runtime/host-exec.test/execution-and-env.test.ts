import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { afterAll, describe, expect, it } from 'vitest'
import { spawn } from '../host-exec.js'

describe('host spawn command and streaming', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'host-exec-test-'))

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('runs executable with args, zero shell interpolation, and streams stdout/stderr', async () => {
    const stdoutChunks: string[] = []
    const stderrChunks: string[] = []
    const result = await spawn({
      command: process.execPath,
      args: [
        '-e',
        'process.stdout.write(process.argv[1]); process.stderr.write("err-chunk");',
        '$HOME && echo nope',
      ],
      cwd: tmpDir,
      onStdout: chunk => stdoutChunks.push(chunk),
      onStderr: chunk => stderrChunks.push(chunk),
    })

    expect(result.exitCode).toBe(0)
    expect(result.signal).toBeNull()
    expect(result.timedOut).toBe(false)
    expect(result.stdout).toBe('$HOME && echo nope')
    expect(result.stderr).toBe('err-chunk')
    expect(stdoutChunks.join('')).toBe('$HOME && echo nope')
    expect(stderrChunks.join('')).toBe('err-chunk')
  })

  it('captures non-zero exit codes, terminating signal, shell mode, and cwd fallback', async () => {
    const nonZero = await spawn({
      command: process.execPath,
      args: ['-e', 'process.exit(7)'],
      cwd: '   ',
    })
    expect(nonZero.exitCode).toBe(7)
    expect(nonZero.signal).toBeNull()

    const signaled = await spawn({
      command: process.execPath,
      args: ['-e', 'process.kill(process.pid, "SIGTERM")'],
    })
    expect(signaled.exitCode).toBeNull()
    expect(signaled.signal).toBe('SIGTERM')

    const shellRes = await spawn({
      command: `${process.execPath} -e "console.log('via-shell')"`,
      shell: true,
    })
    expect(shellRes.exitCode).toBe(0)
    expect(shellRes.stdout.trim()).toBe('via-shell')
  })

  it('rejects on invalid command types, empty commands, and missing binaries', async () => {
    await expect(spawn({ command: 123 as unknown as string })).rejects.toThrow(
      'Host spawn "command" must be a non-empty string.',
    )
    await expect(spawn({ command: '' })).rejects.toThrow(
      'Host spawn "command" must be a non-empty string.',
    )
    await expect(spawn({ command: '   ' })).rejects.toThrow(
      'Host spawn "command" must be a non-empty string.',
    )
    await expect(spawn({ command: 'non-existent-ludd-binary-xyz' })).rejects.toThrow()
    await expect(spawn({ command: 'non-existent-ludd-binary-xyz', timeoutMs: 5000 })).rejects.toThrow()
  })
})

describe('host spawn environment inheritance', () => {
  it('inherits process.env by default and isolates when inheritEnv is false', async () => {
    const prev = process.env.LUDD_TEST_INHERIT_KEY
    process.env.LUDD_TEST_INHERIT_KEY = 'secret-val'
    try {
      const inherited = await spawn({
        command: process.execPath,
        args: [
          '-e',
          'console.log(JSON.stringify({ inherited: process.env.LUDD_TEST_INHERIT_KEY, extra: process.env.EXTRA }))',
        ],
        env: { EXTRA: 'yes' },
      })
      expect(JSON.parse(inherited.stdout)).toEqual({ inherited: 'secret-val', extra: 'yes' })

      const isolated = await spawn({
        command: process.execPath,
        args: [
          '-e',
          'console.log(JSON.stringify({ inherited: process.env.LUDD_TEST_INHERIT_KEY ?? null, extra: process.env.EXTRA }))',
        ],
        inheritEnv: false,
        env: { EXTRA: 'only' },
      })
      expect(JSON.parse(isolated.stdout)).toEqual({ inherited: null, extra: 'only' })
    }
    finally {
      if (prev === undefined) {
        delete process.env.LUDD_TEST_INHERIT_KEY
      }
      else {
        process.env.LUDD_TEST_INHERIT_KEY = prev
      }
    }
  })
})

describe('host spawn env sanitization', () => {
  it('sanitizes host env with sanitizeEnv and allowedEnvKeys', async () => {
    const prevSecret = process.env.LUDD_TEST_SECRET
    const prevAllowed = process.env.LUDD_TEST_ALLOWED
    process.env.LUDD_TEST_SECRET = 'do-not-leak'
    process.env.LUDD_TEST_ALLOWED = 'permitted-val'
    try {
      const res = await spawn({
        command: process.execPath,
        args: [
          '-e',
          'console.log(JSON.stringify({ secret: process.env.LUDD_TEST_SECRET ?? null, allowed: process.env.LUDD_TEST_ALLOWED ?? null, explicit: process.env.EXPLICIT_KEY ?? null, pathSet: Boolean(process.env.PATH) }))',
        ],
        sanitizeEnv: true,
        allowedEnvKeys: ['LUDD_TEST_ALLOWED'],
        env: { EXPLICIT_KEY: 'explicit-val' },
      })
      expect(JSON.parse(res.stdout)).toEqual({
        secret: null,
        allowed: 'permitted-val',
        explicit: 'explicit-val',
        pathSet: true,
      })
    }
    finally {
      if (prevSecret === undefined) {
        delete process.env.LUDD_TEST_SECRET
      }
      else {
        process.env.LUDD_TEST_SECRET = prevSecret
      }
      if (prevAllowed === undefined) {
        delete process.env.LUDD_TEST_ALLOWED
      }
      else {
        process.env.LUDD_TEST_ALLOWED = prevAllowed
      }
    }
  })
})
