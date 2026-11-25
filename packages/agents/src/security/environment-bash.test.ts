import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { afterAll, describe, expect, it } from 'vitest'
import { createEnvironmentBashOperations, environmentBashTool } from './environment-bash.js'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ludd-env-bash-'))
const subDir = path.join(tmpDir, 'sub')
fs.mkdirSync(subDir, { recursive: true })

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('environment bash host spawn delegation', () => {
  it('runs commands via host spawn, streams stdout/stderr, resolves cwd, and merges env', async () => {
    const chunks: string[] = []
    const ops = createEnvironmentBashOperations({
      cwd: tmpDir,
      env: { HOST_VAR: 'from-host', SHARED: 'host-wins' },
    })

    const cmd = `${JSON.stringify(process.execPath)} -e "process.stdout.write(JSON.stringify({ cwd: process.cwd(), host: process.env.HOST_VAR, exec: process.env.EXEC_VAR, shared: process.env.SHARED, undef: process.env.UNDEF_VAR ?? null })); process.stderr.write('|err-part');"`
    const res = await ops.exec(cmd, 'sub', {
      onData: data => chunks.push(data.toString('utf8')),
      env: { EXEC_VAR: 'from-exec', SHARED: 'from-exec', UNDEF_VAR: undefined },
    })

    expect(res).toEqual({ exitCode: 0 })
    const combined = chunks.join('')
    expect(combined).toContain('|err-part')
    const jsonPart = combined.replace('|err-part', '')
    expect(JSON.parse(jsonPart)).toEqual({
      cwd: fs.realpathSync(subDir),
      host: 'from-host',
      exec: 'from-exec',
      shared: 'host-wins',
      undef: null,
    })
  })

  it('falls back to hostOptions.cwd when cwd is empty, whitespace, or non-string and handles omitted hostOptions.env', async () => {
    const chunks: string[] = []
    const ops = createEnvironmentBashOperations({ cwd: tmpDir })
    const cmd = `${JSON.stringify(process.execPath)} -e "process.stdout.write(process.cwd())"`

    for (const fallbackCwd of ['', '   ', undefined as never]) {
      chunks.length = 0
      const res = await ops.exec(cmd, fallbackCwd, {
        onData: data => chunks.push(data.toString('utf8')),
      })

      expect(res).toEqual({ exitCode: 0 })
      expect(chunks.join('')).toBe(fs.realpathSync(tmpDir))
    }
  })

  it('throws timeout:<seconds> when command exceeds timeout', async () => {
    const ops = createEnvironmentBashOperations({ cwd: tmpDir })
    const cmd = `${JSON.stringify(process.execPath)} -e "setInterval(() => {}, 1000)"`

    await expect(ops.exec(cmd, '', {
      onData: () => {},
      timeout: 0.05,
    })).rejects.toThrow('timeout:0.05')
  })
})

describe('environment bash signal handling', () => {
  it('terminates on host signal, exec signal, or combined signals', async () => {
    const longCmd = `${JSON.stringify(process.execPath)} -e "console.log('ready'); setInterval(() => {}, 1000)"`

    const hostCtrl = new AbortController()
    const hostOnlyOps = createEnvironmentBashOperations({ cwd: tmpDir, signal: hostCtrl.signal })
    await expect(hostOnlyOps.exec(longCmd, '', {
      onData: (chunk) => {
        if (chunk.toString('utf8').includes('ready')) {
          hostCtrl.abort(new Error('host-aborted'))
        }
      },
    })).rejects.toThrow('host-aborted')

    const execCtrl = new AbortController()
    const execOnlyOps = createEnvironmentBashOperations({ cwd: tmpDir })
    await expect(execOnlyOps.exec(longCmd, '', {
      signal: execCtrl.signal,
      onData: (chunk) => {
        if (chunk.toString('utf8').includes('ready')) {
          execCtrl.abort(new Error('exec-aborted'))
        }
      },
    })).rejects.toThrow('exec-aborted')

    const combinedHostCtrl = new AbortController()
    const combinedExecCtrl = new AbortController()
    const combinedOps = createEnvironmentBashOperations({ cwd: tmpDir, signal: combinedHostCtrl.signal })
    await expect(combinedOps.exec(longCmd, '', {
      signal: combinedExecCtrl.signal,
      onData: (chunk) => {
        if (chunk.toString('utf8').includes('ready')) {
          combinedExecCtrl.abort(new Error('combined-aborted'))
        }
      },
    })).rejects.toThrow('combined-aborted')
  })
})

describe('environmentBashTool wrapper', () => {
  it('returns undefined when options are omitted and executes bash via spawn when provided', async () => {
    expect(environmentBashTool(undefined)).toBeUndefined()

    const tool = environmentBashTool({
      cwd: tmpDir,
      env: { TOOL_ENV: 'hello-tool' },
    })!
    expect(tool.name).toBe('bash')

    const result = await tool.execute(
      'call-1',
      { command: `${JSON.stringify(process.execPath)} -e "console.log(process.env.TOOL_ENV)"` },
      undefined,
      undefined,
      {
        cwd: tmpDir,
        sessionManager: {
          getSessionId: () => 's-1',
          getSessionFile: () => undefined,
        },
      } as never,
    )
    const content = result.content[0] as { text?: string }
    expect(content.text).toContain('hello-tool')
  })
})
