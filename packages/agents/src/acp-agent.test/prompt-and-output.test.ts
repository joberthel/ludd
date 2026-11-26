import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { StepOutputValidationError } from '@luddjs/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { acpAgent } from '../acp-agent.js'
import { FAKE_ACP_SERVER, isProcessAlive, makeTurnInput, readPidFile } from './helpers.js'

describe('acpAgent prompt execution and structured output', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'ludd-acp-prompt-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('executes a plain text turn and cleans up child process', async () => {
    const pidFile = path.join(dir, 'server.pid')
    const agent = acpAgent<string>({
      command: process.execPath,
      args: [FAKE_ACP_SERVER],
      env: { FAKE_ACP_PID_FILE: pidFile },
      prompt: 'say hello',
    })

    const result = await agent.executeTurn(makeTurnInput(dir, { prompt: 'say hello' }))
    expect(result.output).toBe('Hello world!')
    expect(result.sessionId).toBe('fake-session-1')
    expect(isProcessAlive(readPidFile(pidFile))).toBe(false)
  })

  it('forwards cwd and merged env (config.env overrides input.env)', async () => {
    const agent = acpAgent<string>({
      command: process.execPath,
      args: [FAKE_ACP_SERVER],
      env: {
        FAKE_ACP_SCENARIO: 'echo-env',
        FAKE_CONFIG_ENV: 'from-config',
        FAKE_INPUT_ENV: 'overridden-by-config',
      },
    })

    const result = await agent.executeTurn(makeTurnInput(dir, {
      env: { FAKE_INPUT_ENV: 'from-input' },
    }))
    const parsed = JSON.parse(result.output) as Record<string, string>
    expect(parsed.configEnv).toBe('from-config')
    expect(parsed.inputEnv).toBe('overridden-by-config')
    expect(parsed.sessionCwd).toBe(parsed.cwd)
  })

  it('appends JSON Schema instructions when outputSchema is provided', async () => {
    const schema = z.object({
      status: z.enum(['ok', 'fail']),
    })
    const agent = acpAgent<string>({
      command: process.execPath,
      args: [FAKE_ACP_SERVER],
      env: { FAKE_ACP_SCENARIO: 'echo-prompt' },
    })

    await expect(agent.executeTurn(makeTurnInput(dir, {
      prompt: 'Check build',
      outputSchema: schema,
    }))).rejects.toThrow(StepOutputValidationError)

    const plainEcho = acpAgent<string>({
      command: process.execPath,
      args: [FAKE_ACP_SERVER],
      env: { FAKE_ACP_SCENARIO: 'echo-prompt' },
    })
    const rawResult = await plainEcho.executeTurn(makeTurnInput(dir, { prompt: 'Check build' }))
    expect(rawResult.output).toBe('Check build')

    const { buildPromptWithSchema } = await import('../acp-output.js')
    const augmented = buildPromptWithSchema('Check build', schema)
    expect(augmented).toContain('Check build')
    expect(augmented).toContain('"enum"')
    expect(augmented).toContain('"status"')
  })

  it('parses raw JSON and fenced JSON blocks against outputSchema', async () => {
    const schema = z.object({
      ok: z.boolean(),
      count: z.number(),
    })

    const rawJsonAgent = acpAgent<{ ok: boolean, count: number }>({
      command: process.execPath,
      args: [FAKE_ACP_SERVER],
      env: {
        FAKE_ACP_SCENARIO: 'response',
        FAKE_ACP_RESPONSE: '{"ok":true,"count":3}',
      },
    })
    const rawRes = await rawJsonAgent.executeTurn(makeTurnInput(dir, { outputSchema: schema }))
    expect(rawRes.output).toEqual({ ok: true, count: 3 })

    const fencedAgent = acpAgent<{ ok: boolean, count: number }>({
      command: process.execPath,
      args: [FAKE_ACP_SERVER],
      env: {
        FAKE_ACP_SCENARIO: 'response',
        FAKE_ACP_RESPONSE: 'Here is the output:\n```json\n{"ok":false,"count":7}\n```\nDone.',
      },
    })
    const fencedRes = await fencedAgent.executeTurn(makeTurnInput(dir, { outputSchema: schema }))
    expect(fencedRes.output).toEqual({ ok: false, count: 7 })

    const multiFenceAgent = acpAgent<{ ok: boolean, count: number }>({
      command: process.execPath,
      args: [FAKE_ACP_SERVER],
      env: {
        FAKE_ACP_SCENARIO: 'response',
        FAKE_ACP_RESPONSE: [
          'First snippet:',
          '```ts',
          'const x = 1',
          '```',
          'Final answer:',
          '```json',
          '{"ok":true,"count":9}',
          '```',
        ].join('\n'),
      },
    })
    const multiFenceRes = await multiFenceAgent.executeTurn(makeTurnInput(dir, { outputSchema: schema }))
    expect(multiFenceRes.output).toEqual({ ok: true, count: 9 })

    const untaggedFenceAgent = acpAgent<{ ok: boolean, count: number }>({
      command: process.execPath,
      args: [FAKE_ACP_SERVER],
      env: {
        FAKE_ACP_SCENARIO: 'response',
        FAKE_ACP_RESPONSE: '```bash\necho hi\n```\n```\n{"ok":false,"count":4}\n```',
      },
    })
    const untaggedRes = await untaggedFenceAgent.executeTurn(makeTurnInput(dir, { outputSchema: schema }))
    expect(untaggedRes.output).toEqual({ ok: false, count: 4 })
  })

  it('throws StepOutputValidationError for empty, unparseable, or schema-invalid JSON', async () => {
    const schema = z.object({
      ok: z.boolean(),
    })

    for (const badResponse of [
      '',
      'not json at all',
      '```json\n{"ok":true}',
      '```json\n{bad}\n```',
    ]) {
      const agent = acpAgent({
        command: process.execPath,
        args: [FAKE_ACP_SERVER],
        env: { FAKE_ACP_SCENARIO: 'response', FAKE_ACP_RESPONSE: badResponse },
      })
      await expect(agent.executeTurn(makeTurnInput(dir, { outputSchema: schema }))).rejects.toThrow(
        StepOutputValidationError,
      )
    }

    const mismatchAgent = acpAgent({
      command: process.execPath,
      args: [FAKE_ACP_SERVER],
      env: { FAKE_ACP_SCENARIO: 'response', FAKE_ACP_RESPONSE: '{"ok":"nope"}' },
    })
    await expect(mismatchAgent.executeTurn(makeTurnInput(dir, { outputSchema: schema }))).rejects.toThrow(
      StepOutputValidationError,
    )
  })
})
