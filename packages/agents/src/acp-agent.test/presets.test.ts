import type { AcpPresetOptions } from '../acp-presets.js'
import fs from 'node:fs'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { isAgentRunner } from '@luddjs/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { agyAcp, claudeAcp, codexAcp } from '../acp-presets.js'
import { FAKE_ACP_SERVER, makeTurnInput } from './helpers.js'

describe('acp preset factories (claudeAcp, codexAcp, agyAcp)', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'ludd-acp-presets-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('creates AgentRunners with default readOnly mode and default --acp args for each CLI binary', async () => {
    const binDir = path.join(dir, 'bin')
    fs.mkdirSync(binDir, { recursive: true })

    const presets = [
      { name: 'claude', factory: claudeAcp },
      { name: 'codex', factory: codexAcp },
      { name: 'agy', factory: agyAcp },
    ] as const

    for (const preset of presets) {
      const runner = preset.factory()
      expect(isAgentRunner(runner)).toBe(true)
      expect(runner.mode).toBe('read-only')
      expect(runner.prompt).toBe('')
      expect(runner.sessionId).toBeUndefined()

      const argvFile = path.join(dir, `${preset.name}-argv.json`)
      const shimPath = path.join(binDir, preset.name)
      const shimScript = [
        `#!${process.execPath}`,
        `import fs from 'node:fs'`,
        `import { pathToFileURL } from 'node:url'`,
        `fs.writeFileSync(${JSON.stringify(argvFile)}, JSON.stringify(process.argv.slice(2)), 'utf8')`,
        `await import(pathToFileURL(${JSON.stringify(FAKE_ACP_SERVER)}).href)`,
      ].join('\n')
      await writeFile(shimPath, shimScript, 'utf8')
      await chmod(shimPath, 0o755)

      const result = await runner.executeTurn(makeTurnInput(dir, {
        env: {
          PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}`,
        },
      }))

      expect(result.output).toBe('Hello world!')
      expect(result.sessionId).toBe('fake-session-1')
      expect(JSON.parse(fs.readFileSync(argvFile, 'utf8'))).toEqual(['--acp'])
    }
  })

  it('forwards AcpPresetOptions overrides (command, args, env, permissionMode, prompt, sessionId, shutdownTimeoutMs, mcpBridge)', async () => {
    const argvFile = path.join(dir, 'override-argv.json')
    const options: AcpPresetOptions = {
      command: process.execPath,
      args: [FAKE_ACP_SERVER, '--custom-arg'],
      env: {
        FAKE_ACP_ARGV_FILE: argvFile,
        FAKE_ACP_SCENARIO: 'echo-env',
        FAKE_CONFIG_ENV: 'preset-env',
      },
      permissionMode: 'acceptEdits',
      prompt: 'override prompt',
      sessionId: 'preset-session-1',
      shutdownTimeoutMs: 2500,
      mcpBridge: {
        command: 'custom-ludd',
        args: ['mcp-bridge'],
      },
    }

    for (const factory of [claudeAcp, codexAcp, agyAcp]) {
      const runner = factory(options)
      expect(runner.mode).toBe('workspace-write')
      expect(runner.prompt).toBe('override prompt')
      expect(runner.sessionId).toBe('preset-session-1')

      const result = await runner.executeTurn(makeTurnInput(dir))
      const parsed = JSON.parse(result.output as string) as Record<string, string>
      expect(parsed.configEnv).toBe('preset-env')
      expect(result.sessionId).toBe('preset-session-1')
      expect(JSON.parse(fs.readFileSync(argvFile, 'utf8'))).toEqual([
        '--custom-arg',
      ])
    }
  })

  it('supports bypassPermissions and preserves empty args override', () => {
    const runner = claudeAcp({
      permissionMode: 'bypassPermissions',
      args: [],
    })
    expect(runner.mode).toBe('workspace-write')
  })
})
