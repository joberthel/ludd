import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { dockerWorktreeEnv, translateMcpServerUrl } from '../docker-worktree-env.js'
import * as hostEnvModule from '../host-env.js'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-dock-exec-test-'))
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

async function createTestEnv(bridgeHost?: string, defaultSignal?: AbortSignal) {
  const execSpy = vi.spyOn(hostEnvModule, 'execHostEnvCommand')
  execSpy.mockResolvedValueOnce({
    exitCode: 0,
    stdout: '',
    stderr: '',
    timedOut: false,
  })
  execSpy.mockResolvedValueOnce({
    exitCode: 0,
    stdout: 'c-test-id\n',
    stderr: '',
    timedOut: false,
  })

  const adapter = dockerWorktreeEnv({ id: 'dock-exec', bridgeHost })
  const env = await adapter.provision({ runId: 'r-exec', workspaceDir: tmpDir, defaultSignal })
  return { env, execSpy }
}

describe('translateMcpServerUrl unit tests', () => {
  it('translates 127.0.0.1 and localhost to bridge host with and without scheme', () => {
    expect(translateMcpServerUrl('http://127.0.0.1:3000')).toBe('http://host.docker.internal:3000')
    expect(translateMcpServerUrl('http://localhost:3000')).toBe('http://host.docker.internal:3000')
    expect(translateMcpServerUrl('http://127.0.0.1:3000/sse')).toBe('http://host.docker.internal:3000/sse')
    expect(translateMcpServerUrl('127.0.0.1:4000')).toBe('http://host.docker.internal:4000')
    expect(translateMcpServerUrl('localhost:4000')).toBe('http://host.docker.internal:4000')
    expect(translateMcpServerUrl('https://localhost:4000')).toBe('https://host.docker.internal:4000')
  })

  it('supports custom bridge host and preserves non-loopback URLs', () => {
    expect(translateMcpServerUrl('http://localhost:3000', '172.17.0.1')).toBe('http://172.17.0.1:3000')
    expect(translateMcpServerUrl('http://api.remote.service:8080')).toBe('http://api.remote.service:8080')
  })
})

describe('dockerWorktreeEnv exec command formatting & validation', () => {
  it('formats array commands directly and string commands via sh -c', async () => {
    const { env, execSpy } = await createTestEnv()
    execSpy.mockResolvedValue({
      exitCode: 0,
      stdout: 'ok',
      stderr: '',
      timedOut: false,
    })

    await env.exec(['npm', 'test'])
    expect(execSpy).toHaveBeenLastCalledWith(
      env.workingDir,
      [
        'docker',
        'exec',
        'c-test-id',
        'npm',
        'test',
      ],
      expect.any(Object),
    )

    await env.exec('echo "hello world"')
    expect(execSpy).toHaveBeenLastCalledWith(
      env.workingDir,
      [
        'docker',
        'exec',
        'c-test-id',
        'sh',
        '-c',
        'echo "hello world"',
      ],
      expect.any(Object),
    )
  })

  it('throws on empty array, empty string, or invalid command type', async () => {
    const { env } = await createTestEnv()

    await expect(env.exec([])).rejects.toThrow('Command array must not be empty.')
    await expect(env.exec('')).rejects.toThrow('Command string must not be empty.')
    await expect(env.exec('   ')).rejects.toThrow('Command string must not be empty.')
    await expect(env.exec(null as any)).rejects.toThrow('Command must be a non-empty string or array of strings.')
  })
})

describe('dockerWorktreeEnv exec env flags, bridge routing & tokens', () => {
  it('converts environment variables to -e flags and routes MCP_SERVER_URL', async () => {
    const { env, execSpy } = await createTestEnv()
    execSpy.mockResolvedValue({
      exitCode: 0,
      stdout: 'ok',
      stderr: '',
      timedOut: false,
    })

    await env.exec(['node', 'app.js'], {
      env: {
        MCP_SERVER_URL: 'http://127.0.0.1:54321/sse',
        MCP_AUTH_TOKEN: 'secret-token-xyz',
        NODE_ENV: 'test',
      },
    })

    expect(execSpy).toHaveBeenLastCalledWith(
      env.workingDir,
      [
        'docker',
        'exec',
        '-e',
        'MCP_SERVER_URL=http://host.docker.internal:54321/sse',
        '-e',
        'MCP_AUTH_TOKEN=secret-token-xyz',
        '-e',
        'NODE_ENV=test',
        'c-test-id',
        'node',
        'app.js',
      ],
      expect.any(Object),
    )
  })
})

describe('dockerWorktreeEnv exec custom bridgeHost', () => {
  it('routes MCP_SERVER_URL with custom bridgeHost', async () => {
    const { env, execSpy } = await createTestEnv('172.17.0.1')
    execSpy.mockResolvedValue({
      exitCode: 0,
      stdout: 'ok',
      stderr: '',
      timedOut: false,
    })

    await env.exec(['node', 'worker.js'], {
      env: {
        MCP_SERVER_URL: 'http://localhost:3000',
      },
    })

    expect(execSpy).toHaveBeenLastCalledWith(
      env.workingDir,
      [
        'docker',
        'exec',
        '-e',
        'MCP_SERVER_URL=http://172.17.0.1:3000',
        'c-test-id',
        'node',
        'worker.js',
      ],
      expect.any(Object),
    )
  })
})

describe('dockerWorktreeEnv exec timeout and signal options', () => {
  it('forwards timeoutMs and signal to host command execution', async () => {
    const defaultCtrl = new AbortController()
    const overrideCtrl = new AbortController()
    const { env, execSpy } = await createTestEnv(undefined, defaultCtrl.signal)
    execSpy.mockResolvedValue({
      exitCode: 0,
      stdout: '',
      stderr: '',
      timedOut: false,
    })

    // Uses defaultSignal when signal option omitted
    await env.exec(['npm', 'run', 'lint'], { timeoutMs: 5000 })
    expect(execSpy).toHaveBeenLastCalledWith(
      env.workingDir,
      expect.any(Array),
      { timeoutMs: 5000, signal: defaultCtrl.signal },
    )

    // Uses override signal when provided
    await env.exec(['npm', 'run', 'build'], { signal: overrideCtrl.signal })
    expect(execSpy).toHaveBeenLastCalledWith(
      env.workingDir,
      expect.any(Array),
      { timeoutMs: undefined, signal: overrideCtrl.signal },
    )
  })
})
