import type { HarnessConfig } from '../../types/harness.js'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HarnessConfigError } from '../../errors/harness-config-error.js'
import { runHarness } from '../run-harness.js'

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

describe('runHarness configuration validation', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-cfg-val-'))
  })
  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('rejects invalid harness configuration with HarnessConfigError', async () => {
    const invalid = { name: '', steps: [] } as unknown as HarnessConfig
    await expect(runHarness(invalid, { workspaceDir: tempDir })).rejects.toThrow(HarnessConfigError)
    const noRun = {
      name: 'inv',
      steps: [
        { id: 's1' },
      ],
    } as unknown as HarnessConfig
    await expect(runHarness(noRun, { workspaceDir: tempDir })).rejects.toThrow('must have a valid "run" property')
  })
})

describe('runHarness runId and workspaceDir resolution', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-cfg-opt-'))
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    await rm(tempDir, { recursive: true, force: true })
  })

  const minimal: HarnessConfig = {
    name: 'minimal',
    steps: [
      {
        id: 's1',
        run: () => 'ok',
      },
    ],
  }

  it('generates a valid UUID v4 when runId is omitted or whitespace', async () => {
    expect((await runHarness(minimal, { workspaceDir: tempDir })).runId).toMatch(UUID_V4)
    expect((await runHarness(minimal, { workspaceDir: tempDir, runId: '   ' })).runId).toMatch(UUID_V4)
  })

  it('resolves process.cwd() when workspaceDir is omitted or whitespace', async () => {
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tempDir)
    expect((await runHarness(minimal)).status).toBe('passed')
    expect((await runHarness(minimal, {})).status).toBe('passed')
    expect((await runHarness(minimal, { workspaceDir: '   ' })).status).toBe('passed')
    expect(cwdSpy).toHaveBeenCalled()
  })

  it('passes runId and initializes empty context properties', async () => {
    let captured: any
    const result = await runHarness({
      name: 'ctx-init',
      steps: [
        {
          id: 's1',
          run: (ctx) => {
            captured = ctx
          },
        },
      ],
    }, { runId: '  issue-124-9f8a  ', workspaceDir: tempDir })
    expect(result.runId).toBe('issue-124-9f8a')
    expect(captured.runId).toBe('issue-124-9f8a')
    expect(captured.environments).toEqual({})
    expect(captured.artifacts).toEqual({})
  })
})
