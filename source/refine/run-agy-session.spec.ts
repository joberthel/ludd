import { EventEmitter } from 'node:events'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildAgyArgs,
  buildAgySettings,
  createAgySessionFiles,
  runAgyRefineSession,
} from './run-agy-session.js'

describe('runAgyRefineSession helpers', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ludd-agy-helpers-test-'))
  })

  afterEach(async () => {
    await fs.rm(tempDir, { force: true, recursive: true })
  })

  describe('buildAgySettings', () => {
    it('returns the required sandboxed permissions and options', () => {
      const settings = buildAgySettings()
      expect(settings).toEqual({
        allowNonWorkspaceAccess: true,
        toolPermission: 'proceed-in-sandbox',
        permissions: {
          allow: ['mcp(ludd-refine/*)', 'read_file(*)'],
          deny: ['write_file(*)', 'edit_file(*)', 'run_command(*)'],
        },
      })
    })
  })

  describe('createAgySessionFiles', () => {
    it('creates .agents/mcp_config.json and .agents/skills.json', async () => {
      const testMcpUrl = 'http://127.0.0.1:4567/mcp/abc123token'
      const customLuddHome = path.join(tempDir, 'custom-ludd')
      const { mcpConfigPath, skillsConfigPath } = await createAgySessionFiles(tempDir, {
        mcpUrl: testMcpUrl,
        luddHomeDir: customLuddHome,
      })

      const mcpContent = JSON.parse(await fs.readFile(mcpConfigPath, 'utf8'))
      expect(mcpContent).toEqual({
        mcpServers: {
          'ludd-refine': {
            serverUrl: testMcpUrl,
            timeoutSeconds: -1,
          },
        },
      })

      const skillsContent = JSON.parse(await fs.readFile(skillsConfigPath, 'utf8'))
      expect(skillsContent).toEqual({
        entries: [
          {
            path: path.join(customLuddHome, 'skills'),
          },
        ],
      })
    })
  })

  describe('buildAgyArgs', () => {
    it('builds command line arguments with settings and prompt', () => {
      const args = buildAgyArgs({
        model: 'gemini-4-argon-medium',
        sessionDir: '/tmp/session-123',
        taskId: 42,
        taskName: 'Implement MCP runner',
      })

      expect(args).toEqual([
        '--sandbox',
        '--model',
        'gemini-4-argon-medium',
        '--add-dir',
        '/tmp/session-123',
        '--settings',
        JSON.stringify(buildAgySettings()),
        '-p',
        '/refine Task #42: Implement MCP runner',
      ])
      expect(args).not.toContain('--effort')
    })
  })
})

describe('runAgyRefineSession execution lifecycle', () => {
  interface MockChildProcess extends EventEmitter {
    exitCode: number | null
    killed: boolean
    kill: (sig?: string) => boolean
    stderr: Readable
    stdout: Readable
  }

  function createMockChild(): MockChildProcess {
    const child = new EventEmitter() as MockChildProcess
    child.exitCode = null
    child.killed = false
    child.kill = vi.fn().mockImplementation(() => {
      child.killed = true
      return true
    })
    child.stderr = new Readable({
      read() {},
    })
    child.stdout = new Readable({
      read() {},
    })
    return child
  }

  const sampleTask = {
    id: 7,
    name: 'Add auth middleware',
    branch: 'task/7-add-auth',
    status: 'refinement' as const,
    created: '2026-11-01T00:00:00.000Z',
    updated: '2026-11-01T00:00:00.000Z',
  }

  const sampleProject = {
    slug: 'my-project',
    name: 'My Project',
    path: '/path/to/my-project',
    created: '2026-11-01T00:00:00.000Z',
    updated: '2026-11-01T00:00:00.000Z',
  }

  it('spawns agy with correct arguments and resolves on exit code 0', async () => {
    const mockChild = createMockChild()
    let capturedCommand = ''
    let capturedArgs: readonly string[] = []
    let capturedOptions: any

    const spawnFn = vi.fn().mockImplementation((command, args, options) => {
      capturedCommand = command
      capturedArgs = args
      capturedOptions = options
      queueMicrotask(() => {
        mockChild.exitCode = 0
        mockChild.emit('close', 0, null)
      })
      return mockChild
    })

    await runAgyRefineSession({
      task: sampleTask,
      project: sampleProject,
      model: 'gemini-4-argon-medium',
      mcpServer: { url: 'http://127.0.0.1:9999/mcp/tok' },
      spawnFn,
    })

    expect(capturedCommand).toBe('agy')
    expect(capturedOptions.cwd).toBe(sampleProject.path)
    expect(capturedArgs).toContain('--sandbox')
    expect(capturedArgs).toContain('gemini-4-argon-medium')
    expect(capturedArgs).toContain('/refine Task #7: Add auth middleware')
    expect(capturedArgs).not.toContain('--effort')
  })

  it('rejects and cleans up temp directory if agy exits with non-zero exit code', async () => {
    const mockChild = createMockChild()

    const spawnFn = vi.fn().mockImplementation(() => {
      process.nextTick(() => {
        mockChild.stderr.push('Internal agy error: network failure\n')
        mockChild.stderr.push(null)
        process.nextTick(() => {
          mockChild.exitCode = 1
          mockChild.emit('close', 1, null)
        })
      })
      return mockChild
    })

    await expect(
      runAgyRefineSession({
        task: sampleTask,
        project: sampleProject,
        model: 'gemini-4-argon-medium',
        mcpServer: { url: 'http://127.0.0.1:9999/mcp/tok' },
        spawnFn,
      }),
    ).rejects.toThrow('agy exited with code 1: Internal agy error: network failure')
  })

  it('rejects if terminated by signal', async () => {
    const mockChild = createMockChild()

    const spawnFn = vi.fn().mockImplementation(() => {
      process.nextTick(() => {
        mockChild.stderr.push(null)
        mockChild.emit('close', null, 'SIGTERM')
      })
      return mockChild
    })

    await expect(
      runAgyRefineSession({
        task: sampleTask,
        project: sampleProject,
        model: 'gemini-4-argon-medium',
        mcpServer: { url: 'http://127.0.0.1:9999/mcp/tok' },
        spawnFn,
      }),
    ).rejects.toThrow('agy process terminated by signal SIGTERM')
  })

  it('rejects when child process emits error (e.g. ENOENT)', async () => {
    const mockChild = createMockChild()
    const spawnFn = vi.fn().mockImplementation(() => {
      process.nextTick(() => {
        mockChild.emit('error', new Error('spawn agy ENOENT'))
      })
      return mockChild
    })

    await expect(
      runAgyRefineSession({
        task: sampleTask,
        project: sampleProject,
        model: 'gemini-4-argon-medium',
        mcpServer: { url: 'http://127.0.0.1:9999/mcp/tok' },
        spawnFn,
      }),
    ).rejects.toThrow('spawn agy ENOENT')
  })

  it('kills child process when abort signal fires and waits for termination', async () => {
    const mockChild = createMockChild()
    const abortController = new AbortController()

    const spawnFn = vi.fn().mockImplementation(() => {
      process.nextTick(() => {
        abortController.abort()
        process.nextTick(() => {
          mockChild.emit('close', null, 'SIGTERM')
        })
      })
      return mockChild
    })

    const runPromise = runAgyRefineSession({
      task: sampleTask,
      project: sampleProject,
      model: 'gemini-4-argon-medium',
      mcpServer: { url: 'http://127.0.0.1:9999/mcp/tok' },
      signal: abortController.signal,
      spawnFn,
    })

    await expect(runPromise).rejects.toThrow('Refinement session aborted')
    expect(mockChild.kill).toHaveBeenCalledWith('SIGTERM')
  })

  it('waits for child termination before deleting sessionTempDir on abort', async () => {
    const mockChild = createMockChild()
    const abortController = new AbortController()
    let capturedSessionDir = ''
    let sessionDirExistedDuringAbort = false

    const spawnFn = vi.fn().mockImplementation((_cmd, args) => {
      const addDirIndex = args.indexOf('--add-dir')
      capturedSessionDir = args[addDirIndex + 1]

      process.nextTick(async () => {
        abortController.abort()
        try {
          await fs.access(capturedSessionDir)
          sessionDirExistedDuringAbort = true
        }
        catch {
          sessionDirExistedDuringAbort = false
        }
        process.nextTick(() => {
          mockChild.emit('close', null, 'SIGTERM')
        })
      })
      return mockChild
    })

    await expect(
      runAgyRefineSession({
        task: sampleTask,
        project: sampleProject,
        model: 'gemini-4-argon-medium',
        mcpServer: { url: 'http://127.0.0.1:9999/mcp/tok' },
        signal: abortController.signal,
        spawnFn,
      }),
    ).rejects.toThrow('Refinement session aborted')

    expect(sessionDirExistedDuringAbort).toBe(true)
    await expect(fs.access(capturedSessionDir)).rejects.toThrow()
  })

  it('does not call child.kill if child has already exited when abort fires', async () => {
    const mockChild = createMockChild()
    mockChild.exitCode = 0
    const abortController = new AbortController()

    const spawnFn = vi.fn().mockImplementation(() => {
      process.nextTick(() => {
        abortController.abort()
        process.nextTick(() => {
          mockChild.emit('close', 0, null)
        })
      })
      return mockChild
    })

    await expect(
      runAgyRefineSession({
        task: sampleTask,
        project: sampleProject,
        model: 'gemini-4-argon-medium',
        mcpServer: { url: 'http://127.0.0.1:9999/mcp/tok' },
        signal: abortController.signal,
        spawnFn,
      }),
    ).rejects.toThrow('Refinement session aborted')

    expect(mockChild.kill).not.toHaveBeenCalled()
  })

  it('does not call child.kill if child is already marked killed when abort fires', async () => {
    const mockChild = createMockChild()
    mockChild.killed = true
    const abortController = new AbortController()

    const spawnFn = vi.fn().mockImplementation(() => {
      process.nextTick(() => {
        abortController.abort()
        process.nextTick(() => {
          mockChild.emit('close', null, 'SIGTERM')
        })
      })
      return mockChild
    })

    await expect(
      runAgyRefineSession({
        task: sampleTask,
        project: sampleProject,
        model: 'gemini-4-argon-medium',
        mcpServer: { url: 'http://127.0.0.1:9999/mcp/tok' },
        signal: abortController.signal,
        spawnFn,
      }),
    ).rejects.toThrow('Refinement session aborted')

    expect(mockChild.kill).not.toHaveBeenCalled()
  })

  it('rejects with abort error when aborted child emits error', async () => {
    const mockChild = createMockChild()
    const abortController = new AbortController()

    const spawnFn = vi.fn().mockImplementation(() => {
      process.nextTick(() => {
        abortController.abort()
        process.nextTick(() => {
          mockChild.emit('error', new Error('Child killed abruptly'))
        })
      })
      return mockChild
    })

    await expect(
      runAgyRefineSession({
        task: sampleTask,
        project: sampleProject,
        model: 'gemini-4-argon-medium',
        mcpServer: { url: 'http://127.0.0.1:9999/mcp/tok' },
        signal: abortController.signal,
        spawnFn,
      }),
    ).rejects.toThrow('Refinement session aborted')
  })

  it('rejects immediately without spawning if signal is already aborted', async () => {
    const spawnFn = vi.fn()
    const abortController = new AbortController()
    abortController.abort()

    await expect(
      runAgyRefineSession({
        task: sampleTask,
        project: sampleProject,
        model: 'gemini-4-argon-medium',
        mcpServer: { url: 'http://127.0.0.1:9999/mcp/tok' },
        signal: abortController.signal,
        spawnFn,
      }),
    ).rejects.toThrow('Refinement session aborted')

    expect(spawnFn).not.toHaveBeenCalled()
  })

  it('cleans up temporary session directory on completion', async () => {
    let capturedSessionDir = ''
    const mockChild = createMockChild()

    const spawnFn = vi.fn().mockImplementation((_cmd, args) => {
      const addDirIndex = args.indexOf('--add-dir')
      capturedSessionDir = args[addDirIndex + 1]
      queueMicrotask(() => {
        mockChild.exitCode = 0
        mockChild.emit('close', 0, null)
      })
      return mockChild
    })

    await runAgyRefineSession({
      task: sampleTask,
      project: sampleProject,
      model: 'gemini-4-argon-medium',
      mcpServer: { url: 'http://127.0.0.1:9999/mcp/tok' },
      spawnFn,
    })

    expect(capturedSessionDir).toBeTruthy()
    // Verify directory was removed
    await expect(fs.access(capturedSessionDir)).rejects.toThrow()
  })

  it('invokes onSpawn callback with the child process upon spawn', async () => {
    const mockChild = createMockChild()
    mockChild.pid = 4321
    const spawnFn = vi.fn().mockImplementation(() => {
      queueMicrotask(() => {
        mockChild.exitCode = 0
        mockChild.emit('close', 0, null)
      })
      return mockChild
    })

    const onSpawnSpy = vi.fn()

    await runAgyRefineSession({
      task: sampleTask,
      project: sampleProject,
      model: 'gemini-4-argon-medium',
      mcpServer: { url: 'http://127.0.0.1:9999/mcp/tok' },
      spawnFn,
      onSpawn: onSpawnSpy,
    })

    expect(onSpawnSpy).toHaveBeenCalledWith(mockChild)
  })
})
