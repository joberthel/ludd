import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { runHarness } from '@ludd/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { piAgent } from '../pi-agent.js'
import { fakeSession } from './fake-session.js'

describe('piAgent inside runHarness (AC 2, AC 4)', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'ludd-pi-harness-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('resumes the earlier session via ctx.steps[...].output.sessionId', async () => {
    const files: string[] = []
    const factory = async (o: { sessionFile: string }): Promise<ReturnType<typeof fakeSession>> => {
      files.push(o.sessionFile)
      return fakeSession([
        { type: 'agent_settled' },
      ], 'ok')
    }
    const result = await runHarness({
      name: 'pi',
      steps: [
        {
          id: 'a',
          run: piAgent({ prompt: 'one', sessionFactory: factory }),
        },
        {
          id: 'b',
          run: piAgent({
            prompt: 'two',
            sessionId: (ctx: any) => ctx.steps.a.output.sessionId,
            sessionFactory: factory,
          }),
        },
      ],
    } as never, { workspaceDir: dir })

    expect(result.status).toBe('passed')
    const a = result.steps.a?.output as { sessionId: string }
    expect((a as { value?: string }).value).toBe('ok')
    expect(files[1]).toBe(files[0])
    expect(files[0]).toContain(`${a.sessionId}.jsonl`)
  })
})
