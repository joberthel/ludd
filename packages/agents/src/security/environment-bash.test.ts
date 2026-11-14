import type { EnvironmentExecResult, ProvisionedEnvironment } from '@ludd/core'
import { Buffer } from 'node:buffer'
import { describe, expect, it, vi } from 'vitest'
import { createEnvironmentBashOperations, environmentBashTool } from './environment-bash.js'

function fakeEnv(type: string, result: Partial<EnvironmentExecResult> = {}) {
  const exec = vi.fn(async (..._a: unknown[]): Promise<EnvironmentExecResult> => ({
    exitCode: 0,
    stdout: 'out',
    stderr: 'err',
    timedOut: false,
    ...result,
  }))
  return {
    env: { type, workingDir: '/w', exec } as unknown as ProvisionedEnvironment,
    exec,
  }
}

describe('environment bash delegation', () => {
  it('runs commands through environment.exec() and streams output', async () => {
    const { env, exec } = fakeEnv('docker-worktree')
    const onData = vi.fn()
    const signal = new AbortController().signal
    const res = await createEnvironmentBashOperations(env).exec('echo hi', '/w', { onData, signal, timeout: 2 })
    expect(exec).toHaveBeenCalledWith(['sh', '-c', 'echo hi'], { signal, timeoutMs: 2000 })
    expect(onData).toHaveBeenCalledWith(Buffer.from('outerr'))
    expect(res).toEqual({ exitCode: 0 })
  })

  it('omits timeout when unset', async () => {
    const { env, exec } = fakeEnv('docker-worktree')
    await createEnvironmentBashOperations(env).exec('true', '/w', {
      onData: vi.fn(),
    })
    expect(exec).toHaveBeenCalledWith(['sh', '-c', 'true'], { signal: undefined })
  })

  it('throws a timeout error when the command timed out', async () => {
    const { env } = fakeEnv('docker-worktree', { timedOut: true, exitCode: null })
    await expect(createEnvironmentBashOperations(env).exec('sleep 9', '/w', {
      onData: vi.fn(),
      timeout: 1,
    }))
      .rejects
      .toThrow('timeout:1')
  })

  it('only overrides bash for docker-worktree environments', () => {
    expect(environmentBashTool(undefined)).toBeUndefined()
    expect(environmentBashTool(fakeEnv('host').env)).toBeUndefined()
    expect(environmentBashTool(fakeEnv('docker-worktree').env)?.name).toBe('bash')
  })

  it('bash tool executes through the fake environment', async () => {
    const { env, exec } = fakeEnv('docker-worktree')
    const tool = environmentBashTool(env)!
    await tool.execute('id', { command: 'ls' }, undefined, undefined, {
      sessionManager: {
        getSessionId: () => 's',
        getSessionFile: () => undefined,
      },
      cwd: '/w',
    } as never)
    expect(exec).toHaveBeenCalledWith(['sh', '-c', 'ls'], expect.anything())
  })

  it('maps host subdirectory cwd to containerWorkingDir and preserves container subpaths', async () => {
    const { env, exec } = fakeEnv('docker-worktree')
    await createEnvironmentBashOperations(env).exec('ls', '/w/packages/core', {
      onData: vi.fn(),
    })
    expect(exec).toHaveBeenCalledWith(['sh', '-c', 'ls'], { signal: undefined, cwd: '/workspace/packages/core' })

    await createEnvironmentBashOperations(env).exec('pwd', '/workspace/sub', {
      onData: vi.fn(),
    })
    expect(exec).toHaveBeenCalledWith(['sh', '-c', 'pwd'], { signal: undefined, cwd: '/workspace/sub' })
  })
})
