import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadHarnessConfig } from './load-harness-config.js'

const mock = vi.hoisted(() => ({ failBuiltEntryWith: 'ENOENT' }))

vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...original,
    access: vi.fn(async (file: string | URL, ...args: Parameters<typeof original.access> extends [any, ...infer Rest] ? Rest : never) => {
      if (String(file).endsWith('/agents/dist/index.js')) {
        const error = Object.assign(new Error('agents dist entry is unavailable'), { code: mock.failBuiltEntryWith })
        throw error
      }
      return original.access(file, ...args)
    }),
  }
})

const directories: string[] = []
afterEach(() => {
  mock.failBuiltEntryWith = 'ENOENT'
  for (const dir of directories.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('loadHarnessConfig agents source fallback', () => {
  it('loads the agents source entry when its dist entry is absent', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ludd-agent-source-'))
    directories.push(dir)
    const configPath = path.join(dir, 'harness.config.ts')
    fs.writeFileSync(configPath, `import { defineHarness } from '@ludd/core'\nimport { mockAgent } from '@ludd/agents'\nexport default defineHarness({ name: 'source-fallback', steps: [{ id: 'step', run: mockAgent({ prompt: 'hello', responses: [{ ok: true }] }) }] })\n`)
    const config = await loadHarnessConfig(configPath)
    expect(config.name).toBe('source-fallback')
  })

  it('propagates non-missing dist entry errors', async () => {
    mock.failBuiltEntryWith = 'EACCES'
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ludd-agent-source-'))
    directories.push(dir)
    const configPath = path.join(dir, 'harness.config.ts')
    fs.writeFileSync(configPath, `export default { name: 'source-fallback', steps: [{ id: 'step', run: async () => ({ ok: true }) }] }\n`)
    await expect(loadHarnessConfig(configPath)).rejects.toMatchObject({ code: 'EACCES' })
  })
})
