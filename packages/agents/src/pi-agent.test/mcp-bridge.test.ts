import type { PiSessionFactoryOptions } from '../types/pi-sdk.js'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { StepOutputValidationError } from '@ludd/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { piAgent } from '../pi-agent.js'
import { fakeSession, turnInput } from './fake-session.js'

type Exec = (id: string, params: unknown) => Promise<unknown>

function capture(onPrompt?: (opts: PiSessionFactoryOptions) => Promise<void>) {
  const seen: PiSessionFactoryOptions[] = []
  const factory = async (opts: PiSessionFactoryOptions) => {
    seen.push(opts)
    const session = fakeSession([
      { type: 'agent_settled' },
    ], 'raw text')
    const original = session.prompt
    session.prompt = async (p) => {
      await onPrompt?.(opts)
      await original(p)
    }
    return session
  }
  return { seen, factory }
}

describe('piAgent MCP bridge and submit_step_output', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'ludd-pi-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('passes no customTools without MCP url or schema', async () => {
    const { seen, factory } = capture()
    const result = await piAgent({ prompt: 'p', sessionFactory: factory }).executeTurn(turnInput(dir))
    expect(result.output).toBe('raw text')
    expect(seen[0]).not.toHaveProperty('customTools')
  })

  it('exposes MCP tools in read-only mode when a server url is set', async () => {
    const { seen, factory } = capture()
    await piAgent({ prompt: 'p', sessionFactory: factory })
      .executeTurn(turnInput(dir, { mode: 'read-only', mcpServerUrl: 'http://x/mcp', mcpAuthToken: 't' }))
    const names = seen[0]?.customTools?.map(t => t.name)
    expect(names).toContain('put_artifact')
    expect(names).toContain('read_log_page')
    expect(names).not.toContain('submit_step_output')
  })
})

describe('piAgent submit_step_output', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'ludd-pi-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('returns the submitted payload as the turn output', async () => {
    const schema = z.object({
      status: z.string(),
    })
    const { seen, factory } = capture(async (opts) => {
      const submit = opts.customTools?.find(t => t.name === 'submit_step_output')
      const run = (submit as unknown as { execute: Exec }).execute
      await expect(run('1', { status: 1 })).rejects.toThrow('status')
      await run('2', { status: 'ok' })
    })
    const result = await piAgent({ prompt: 'p', sessionFactory: factory })
      .executeTurn(turnInput(dir, { outputSchema: schema }))
    expect(result).toEqual({
      output: { status: 'ok' },
      sessionId: 'sess-1',
    })
    expect(seen[0]?.customTools?.map(t => t.name)).toEqual(['submit_step_output'])
  })

  it('throws StepOutputValidationError when no valid submission was made (raw JSON is not a fallback)', async () => {
    const { factory } = capture()
    const err = await piAgent({ prompt: 'p', sessionFactory: factory })
      .executeTurn(turnInput(dir, {
        outputSchema: z.string(),
      }))
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(StepOutputValidationError)
    expect((err as StepOutputValidationError).rawOutput).toBe('raw text')
    expect((err as StepOutputValidationError).message).toContain('submit_step_output')
  })
})
