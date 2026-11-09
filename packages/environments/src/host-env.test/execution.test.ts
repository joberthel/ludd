import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { hostEnv } from '../host-env.js'

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

describe('hostEnv inheritEnv: false isolation', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'host-env-inherit-false-'))
  const originalHostSecret = process.env.TEST_HOST_SECRET

  beforeEach(() => {
    process.env.TEST_HOST_SECRET = 'host-secret-xyz'
  })

  afterEach(() => {
    if (originalHostSecret === undefined) {
      delete process.env.TEST_HOST_SECRET
    }
    else {
      process.env.TEST_HOST_SECRET = originalHostSecret
    }
  })

  it('does NOT inherit process.env when inheritEnv is false', async () => {
    const env = hostEnv({ cwd: tmpDir })
    const nodePath = process.execPath
    const result = await env.exec([
      nodePath,
      '-e',
      'console.log(JSON.stringify({ hostSec: process.env.TEST_HOST_SECRET, explicit: process.env.EXPLICIT_VAR }))',
    ], {
      inheritEnv: false,
      env: { EXPLICIT_VAR: 'retained-val' },
    })

    expect(result.exitCode).toBe(0)
    const parsed = JSON.parse(result.stdout.trim())
    expect(parsed.hostSec).toBeUndefined()
    expect(parsed.explicit).toBe('retained-val')
  })
})

describe('hostEnv inheritEnv: true or undefined inheritance', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'host-env-inherit-true-'))
  const originalHostSecret = process.env.TEST_HOST_SECRET

  beforeEach(() => {
    process.env.TEST_HOST_SECRET = 'host-secret-xyz'
  })

  afterEach(() => {
    if (originalHostSecret === undefined) {
      delete process.env.TEST_HOST_SECRET
    }
    else {
      process.env.TEST_HOST_SECRET = originalHostSecret
    }
  })

  it('inherits process.env when inheritEnv is true or undefined', async () => {
    const env = hostEnv({ cwd: tmpDir })
    const nodePath = process.execPath

    const resDefault = await env.exec([
      nodePath,
      '-e',
      'console.log(process.env.TEST_HOST_SECRET)',
    ])
    expect(resDefault.exitCode).toBe(0)
    expect(resDefault.stdout.trim()).toBe('host-secret-xyz')

    const resExplicitTrue = await env.exec([
      nodePath,
      '-e',
      'console.log(process.env.TEST_HOST_SECRET, process.env.ADDITIONAL_KEY)',
    ], {
      inheritEnv: true,
      env: { ADDITIONAL_KEY: 'more' },
    })
    expect(resExplicitTrue.exitCode).toBe(0)
    expect(resExplicitTrue.stdout.trim()).toBe('host-secret-xyz more')
  })
})
