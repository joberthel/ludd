import type { EnvironmentAdapter, ProvisionedEnvironment } from '../../types/environment.js'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as mcpServerModule from '../../mcp/mcp-server.js'
import { hasDockerEnvironment, runHarness } from '../run-harness.js'

function createMockDockerAdapter(): EnvironmentAdapter {
  const provisioned: ProvisionedEnvironment = {
    __kind: 'environment',
    id: 'dock-env',
    type: 'docker-worktree',
    workingDir: '/workspace',
    exec: vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 }),
    ping: vi.fn().mockResolvedValue(true),
    teardown: vi.fn().mockResolvedValue(undefined),
  }
  return {
    __kind: 'environment-adapter',
    id: 'dock-env',
    type: 'docker-worktree',
    provision: vi.fn().mockResolvedValue(provisioned),
  }
}

describe('runHarness MCP host binding for Docker environments', () => {
  const tempDirs: string[] = []

  afterEach(() => {
    vi.restoreAllMocks()
    for (const dir of tempDirs) {
      fs.rmSync(dir, { recursive: true, force: true })
    }
    tempDirs.length = 0
  })

  function makeTempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ludd-harness-mcp-'))
    tempDirs.push(dir)
    return dir
  }

  it('passes host 0.0.0.0 to startEmbeddedMcpServer when a step uses docker-worktree', async () => {
    const spy = vi.spyOn(mcpServerModule, 'startEmbeddedMcpServer')
    const workspaceDir = makeTempDir()

    const result = await runHarness(
      {
        name: 'docker-mcp-host-test',
        steps: [
          {
            id: 'step-1',
            environment: createMockDockerAdapter(),
            run: async () => ({ status: 'passed' }),
          },
        ],
      },
      { workspaceDir },
    )

    expect(result.status).toBe('passed')
    expect(spy).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ host: '0.0.0.0' }),
    )
  })

  it('does not pass host 0.0.0.0 when no docker-worktree environment is configured', async () => {
    const spy = vi.spyOn(mcpServerModule, 'startEmbeddedMcpServer')
    const workspaceDir = makeTempDir()

    const result = await runHarness(
      {
        name: 'local-mcp-host-test',
        steps: [
          {
            id: 'step-1',
            run: async () => ({ status: 'passed' }),
          },
        ],
      },
      { workspaceDir },
    )

    expect(result.status).toBe('passed')
    expect(spy).toHaveBeenCalledTimes(1)
    const opts = spy.mock.calls[0]?.[1]
    expect(opts).not.toHaveProperty('host')
  })

  it('detects docker-worktree in rehydrated environments', () => {
    expect(hasDockerEnvironment([], {
      dock: { type: 'docker-worktree' },
    })).toBe(true)
    expect(hasDockerEnvironment([], {
      local: { type: 'host' },
    })).toBe(false)
  })
})
