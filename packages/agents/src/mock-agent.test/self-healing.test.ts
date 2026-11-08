import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { MaxTotalTurnsExceededError, runHarness } from '@ludd/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mockAgent } from '../mock-agent.js'

function createMinLengthSchema(minLength: number) {
  return {
    safeParseAsync: async (val: unknown) => {
      if (
        typeof val === 'object'
        && val !== null
        && 'commitMessage' in val
        && typeof (val as { commitMessage: string }).commitMessage === 'string'
        && (val as { commitMessage: string }).commitMessage.length >= minLength
      ) {
        return { success: true as const, data: val as { commitMessage: string } }
      }
      return {
        success: false as const,
        error: {
          issues: [
            {
              path: ['commitMessage'],
              message: `String must contain at least ${minLength} character(s)`,
            },
          ],
        },
      }
    },
  }
}

describe('mockAgent self-healing retry loop (AC 3.4.1, AC 3.4.2)', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-mock-self-heal-'))
  })
  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('retries with feedback prompt and self-heals on turn 2 (AC 3.4.1)', async () => {
    const receivedPrompts: string[] = []
    const agent = mockAgent<{ commitMessage: string }>({
      prompt: 'Write git commit message',
      responses: [
        (input) => {
          receivedPrompts.push(input.prompt)
          return { commitMessage: 'abc' }
        },
        (input) => {
          receivedPrompts.push(input.prompt)
          return { commitMessage: 'feat: add agent retry' }
        },
      ],
    })

    const result = await runHarness({
      name: 'mock-agent-self-heal',
      steps: [
        {
          id: 'step-commit',
          outputSchema: createMinLengthSchema(5) as any,
          run: agent,
        },
      ],
    }, { workspaceDir: tempDir })

    expect(result.status).toBe('passed')
    expect(receivedPrompts).toHaveLength(2)
    expect(receivedPrompts[0]).toBe('Write git commit message')
    expect(receivedPrompts[1]).toContain('commitMessage')
    expect(receivedPrompts[1]).toContain('Write git commit message')
    expect(result.steps['step-commit']?.output).toEqual({
      commitMessage: 'feat: add agent retry',
      sessionId: expect.stringMatching(/^session-[0-9a-f-]+$/),
    })
  })
})

describe('mockAgent maxTotalTurns circuit breaker (AC 3.4.3)', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-mock-breaker-'))
  })
  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('halts after maxTotalTurns without calling 4th turn', async () => {
    let callCount = 0
    const agent = mockAgent<{ commitMessage: string }>({
      prompt: 'Write git commit message',
      responses: [
        () => {
          callCount += 1
          return { commitMessage: 'a' }
        },
        () => {
          callCount += 1
          return { commitMessage: 'b' }
        },
        () => {
          callCount += 1
          return { commitMessage: 'c' }
        },
        () => {
          callCount += 1
          return { commitMessage: 'never-called' }
        },
      ],
    })

    const result = await runHarness({
      name: 'mock-agent-breaker',
      steps: [
        {
          id: 'step-fail',
          outputSchema: createMinLengthSchema(5) as any,
          maxTotalTurns: 3,
          run: agent,
        },
      ],
    }, { workspaceDir: tempDir })

    expect(result.status).toBe('failed')
    expect(callCount).toBe(3)
    expect(result.error).toBeInstanceOf(MaxTotalTurnsExceededError)
  })
})
