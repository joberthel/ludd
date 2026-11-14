import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { HarnessConfigLoadError } from '../errors/harness-config-load-error.js'
import { loadHarnessConfig } from './load-harness-config.js'

describe('loadHarnessConfig path and file access validation', () => {
  it('rejects empty or whitespace path strings', async () => {
    await expect(loadHarnessConfig('')).rejects.toThrow(HarnessConfigLoadError)
    await expect(loadHarnessConfig('   ')).rejects.toThrow(HarnessConfigLoadError)
  })

  it('rejects non-string input path', async () => {
    const invalidPath = null as unknown as string
    await expect(loadHarnessConfig(invalidPath)).rejects.toThrow(HarnessConfigLoadError)
  })

  it('rejects non-existent file path with cause', async () => {
    const missing = path.resolve(os.tmpdir(), 'missing-harness.config.ts')
    let caught: HarnessConfigLoadError | undefined
    try {
      await loadHarnessConfig(missing)
    }
    catch (error: unknown) {
      caught = error as HarnessConfigLoadError
    }

    expect(caught).toBeInstanceOf(HarnessConfigLoadError)
    expect(caught?.configPath).toBe(missing)
    expect((caught?.cause as { code?: string })?.code).toBe('ENOENT')
  })
})

let tempDir: string

beforeAll(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-loader-test-'))
})

afterAll(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

it('loads valid TypeScript config with defineHarness and @ludd/core alias', async () => {
  const filePath = path.join(tempDir, 'harness.config.ts')
  await writeFile(
    filePath,
    `import { defineHarness } from '@ludd/core';
export default defineHarness({
  name: 'ts-workflow',
  steps: [{ id: 'step-1', run: async () => ({ status: 'done' }) }]
});`,
  )

  const loaded = await loadHarnessConfig(filePath)
  expect(loaded.name).toBe('ts-workflow')
  expect(loaded.steps).toHaveLength(1)
})

it('loads agents from the package entrypoint exposed to config files', async () => {
  const filePath = path.join(tempDir, 'agents.config.ts')
  await writeFile(
    filePath,
    `import { defineHarness } from '@ludd/core';
import { mockAgent } from '@ludd/agents';
export default defineHarness({
  name: 'agents-workflow',
  steps: [{ id: 'agent-step', run: mockAgent({ prompt: 'test', responses: [{ ok: true }] }) }]
});`,
  )

  const loaded = await loadHarnessConfig(filePath)
  expect(loaded.name).toBe('agents-workflow')
})

it('loads valid config using relative file path', async () => {
  const filePath = path.join(tempDir, 'relative.config.ts')
  await writeFile(
    filePath,
    `export default {
  name: 'relative-workflow',
  steps: [{ id: 's-1', run: async () => 42 }]
};`,
  )

  const relativePath = path.relative(process.cwd(), filePath)
  const loaded = await loadHarnessConfig(relativePath)
  expect(loaded.name).toBe('relative-workflow')
})

it('loads valid JavaScript/MJS config with plain default export', async () => {
  const filePath = path.join(tempDir, 'plain.config.mjs')
  await writeFile(
    filePath,
    `export default {
  name: 'mjs-workflow',
  steps: [{ id: 'mjs-step', run: () => 'ok' }]
};`,
  )

  const loaded = await loadHarnessConfig(filePath)
  expect(loaded.name).toBe('mjs-workflow')
})

describe('loadHarnessConfig error handling for syntax and runtime issues', () => {
  let tempDir: string

  beforeAll(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-loader-err-test-'))
  })

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('rejects file with syntax errors with cause', async () => {
    const filePath = path.join(tempDir, 'syntax-err.ts')
    await writeFile(filePath, 'const x: = 123;')

    await expect(loadHarnessConfig(filePath)).rejects.toThrow(HarnessConfigLoadError)
  })

  it('rejects file throwing runtime Error with cause', async () => {
    const filePath = path.join(tempDir, 'runtime-err.ts')
    await writeFile(filePath, 'throw new Error("Evaluation failed");')

    let caught: HarnessConfigLoadError | undefined
    try {
      await loadHarnessConfig(filePath)
    }
    catch (error: unknown) {
      caught = error as HarnessConfigLoadError
    }
    expect(caught).toBeInstanceOf(HarnessConfigLoadError)
    expect(caught?.message).toContain('Evaluation failed')
  })

  it('rejects file throwing non-Error primitive with cause', async () => {
    const filePath = path.join(tempDir, 'primitive-err.ts')
    await writeFile(filePath, 'throw "String exception";')

    let caught: HarnessConfigLoadError | undefined
    try {
      await loadHarnessConfig(filePath)
    }
    catch (error: unknown) {
      caught = error as HarnessConfigLoadError
    }
    expect(caught).toBeInstanceOf(HarnessConfigLoadError)
    expect(caught?.message).toContain('String exception')
  })

  it('rejects file with invalid config structure via validation error', async () => {
    const filePath = path.join(tempDir, 'invalid-structure.ts')
    await writeFile(filePath, 'export default { name: "" };')

    await expect(loadHarnessConfig(filePath)).rejects.toThrow(HarnessConfigLoadError)
  })

  it('rejects file without default export', async () => {
    const filePath = path.join(tempDir, 'no-default.ts')
    await writeFile(filePath, 'export const notADefault = 123;')

    await expect(loadHarnessConfig(filePath)).rejects.toThrow(HarnessConfigLoadError)
  })
})

describe('loadHarnessConfig virtualModules resolution', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-virtual-modules-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('exposes all @ludd/core exports including previously omitted symbols', async () => {
    const filePath = path.join(tempDir, 'core-exports.ts')
    await writeFile(
      filePath,
      [
        `import { defineHarness, teardownRun, gc, createArtifactStore, ForbiddenMountPathError, UnsafeDangerModeError } from '@ludd/core'`,
        `if (typeof teardownRun !== 'function') throw new Error('missing teardownRun')`,
        `if (typeof gc !== 'function') throw new Error('missing gc')`,
        `if (typeof createArtifactStore !== 'function') throw new Error('missing createArtifactStore')`,
        `if (typeof ForbiddenMountPathError !== 'function') throw new Error('missing ForbiddenMountPathError')`,
        `if (typeof UnsafeDangerModeError !== 'function') throw new Error('missing UnsafeDangerModeError')`,
        `export default defineHarness({ name: 'core-exports', steps: [{ id: 's1', run: async () => ({}) }] })`,
      ].join('\n'),
    )

    const loaded = await loadHarnessConfig(filePath)
    expect(loaded.name).toBe('core-exports')
  })

  it('resolves @ludd/agents, @ludd/guardrails, and @ludd/environments', async () => {
    const filePath = path.join(tempDir, 'workspace-pkgs.ts')
    await writeFile(
      filePath,
      [
        `import { defineHarness } from '@ludd/core'`,
        `import * as agents from '@ludd/agents'`,
        `import * as guardrails from '@ludd/guardrails'`,
        `import * as environments from '@ludd/environments'`,
        `if (!agents || !guardrails || !environments) throw new Error('missing workspace package')`,
        `export default defineHarness({ name: 'workspace-pkgs', steps: [{ id: 's1', run: async () => ({}) }] })`,
      ].join('\n'),
    )

    const loaded = await loadHarnessConfig(filePath)
    expect(loaded.name).toBe('workspace-pkgs')
  })

  it('supports custom virtualModules option', async () => {
    const filePath = path.join(tempDir, 'custom-virtual.ts')
    await writeFile(
      filePath,
      [
        `import { defineHarness } from '@ludd/core'`,
        `import { customName } from 'virtual:custom'`,
        `export default defineHarness({ name: customName, steps: [{ id: 's1', run: async () => ({}) }] })`,
      ].join('\n'),
    )

    const loaded = await loadHarnessConfig(filePath, {
      virtualModules: {
        'virtual:custom': { customName: 'from-custom-virtual' },
      },
    })
    expect(loaded.name).toBe('from-custom-virtual')
  })
})
