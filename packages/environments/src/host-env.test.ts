import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { hostEnv } from './host-env.js'

describe('hostEnv.rehydrate', () => {
  it('rehydrates a host environment from descriptor and shares exec/ping/teardown', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ludd-host-rehydrate-'))
    try {
      const adapter = hostEnv({ id: 'host-custom' })
      expect(adapter.rehydrate).toBeDefined()

      const env = await adapter.rehydrate!(
        {
          id: 'host-custom',
          type: 'host',
          workingDir: tmpDir,
          ephemeralPorts: { API: 4123 },
          injectedEnv: { FOO: 'bar' },
          tornDown: false,
        },
        {
          runId: 'run-1',
          workspaceDir: tmpDir,
        },
      )

      expect(env.id).toBe('host-custom')
      expect(env.type).toBe('host')
      expect(env.workingDir).toBe(path.resolve(tmpDir))
      expect(env.ephemeralPorts).toEqual({ API: 4123 })
      expect(env.injectedEnv).toEqual({ FOO: 'bar' })
      expect(await env.ping()).toBe(true)

      const res = await env.exec(['node', '-e', 'process.stdout.write(process.env.FOO ?? "")'])
      expect(res.exitCode).toBe(0)
      expect(res.stdout).toBe('bar')

      await expect(env.teardown()).resolves.toBeUndefined()
    }
    finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })
})
