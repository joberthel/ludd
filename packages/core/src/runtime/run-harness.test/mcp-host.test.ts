import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as mcpServerModule from '../../mcp/mcp-server.js'
import { runHarness } from '../run-harness.js'

describe('runHarness MCP host binding', () => {
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

  it('does not pass host 0.0.0.0 to startEmbeddedMcpServer', async () => {
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
})
