import type { AgentRunner, AgentTurnInput } from '../../types/agent.js'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { readLedgerEvents } from '../../persistence/ledger-writer.js'
import { resolveRunDir } from '../../persistence/state-store.js'
import { runHarness } from '../run-harness.js'
import { putMcpArtifact } from './artifact-helpers.js'

describe('runHarness artifact self-healing for whitespace (AC 4.2.2)', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-art-retry-empty-'))
  })
  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('self-heals on attempt 2 when whitespace-only artifact is corrected', async () => {
    const turns: AgentTurnInput[] = []
    const agent: AgentRunner<string> = {
      __kind: 'agent',
      mode: 'read-only',
      prompt: 'produce doc',
      executeTurn: async (input) => {
        turns.push(input)
        const content = input.attempt === 1
          ? '   \n '
          : '# Non-empty doc'
        await putMcpArtifact(input.mcpServerUrl, input.mcpAuthToken, 'doc.md', content)
        return { output: 'done', sessionId: input.sessionId }
      },
    }

    const result = await runHarness({
      name: 'empty-retry-harness',
      steps: [
        {
          id: 's1',
          run: agent,
          artifacts: {
            'doc.md': { nonEmpty: true },
          },
        },
      ],
    }, { workspaceDir: tempDir })

    expect(result.status).toBe('passed')
    expect(turns).toHaveLength(2)
    expect(turns[1].prompt).toContain('Artifact "doc.md" must be non-empty.')
  })
})

describe('runHarness artifact self-healing for invalid JSON (AC 4.2.2)', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-art-retry-json-'))
  })
  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('self-heals on attempt 2 when invalid JSON is corrected', async () => {
    const turns: AgentTurnInput[] = []
    const schema = z.object({
      active: z.boolean(),
    })
    const agent: AgentRunner<string> = {
      __kind: 'agent',
      mode: 'read-only',
      prompt: 'produce config',
      executeTurn: async (input) => {
        turns.push(input)
        const content = input.attempt === 1
          ? '{not json}'
          : JSON.stringify({ active: true })
        await putMcpArtifact(input.mcpServerUrl, input.mcpAuthToken, 'config.json', content)
        return { output: 'done', sessionId: input.sessionId }
      },
    }

    const result = await runHarness({
      name: 'json-retry-harness',
      steps: [
        {
          id: 's1',
          run: agent,
          artifacts: {
            'config.json': { schema },
          },
        },
      ],
    }, { workspaceDir: tempDir })

    expect(result.status).toBe('passed')
    expect(turns).toHaveLength(2)
    expect(turns[1].prompt).toContain('is not valid JSON:')
  })
})

describe('runHarness artifact self-healing for schema mismatch (AC 4.2.2)', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-art-retry-schema-'))
  })
  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('self-heals on attempt 2 when Zod schema mismatch is corrected', async () => {
    const turns: AgentTurnInput[] = []
    const schema = z.object({
      score: z.number().min(10),
    })
    const agent: AgentRunner<string> = {
      __kind: 'agent',
      mode: 'read-only',
      prompt: 'produce score',
      executeTurn: async (input) => {
        turns.push(input)
        const content = input.attempt === 1
          ? JSON.stringify({ score: 2 })
          : JSON.stringify({ score: 15 })
        await putMcpArtifact(input.mcpServerUrl, input.mcpAuthToken, 'score.json', content)
        return { output: 'done', sessionId: input.sessionId }
      },
    }

    const result = await runHarness({
      name: 'schema-retry-harness',
      steps: [
        {
          id: 's1',
          run: agent,
          artifacts: {
            'score.json': { schema },
          },
        },
      ],
    }, { workspaceDir: tempDir })

    expect(result.status).toBe('passed')
    expect(turns).toHaveLength(2)
    expect(turns[1].prompt).toContain('score.json (score)')

    const runDir = resolveRunDir(tempDir, result.runId)
    const retries = readLedgerEvents(runDir).filter(e => e.eventType === 'step.retry')
    expect(retries).toHaveLength(1)
    expect(retries[0].payload).toMatchObject({ reason: 'artifact_validation_failed' })
  })
})

describe('runHarness artifact self-healing for custom validate (AC 4.2.2)', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-art-retry-validate-'))
  })
  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('self-heals on attempt 2 when custom validate function fails on turn 1', async () => {
    const turns: AgentTurnInput[] = []
    const agent: AgentRunner<string> = {
      __kind: 'agent',
      mode: 'read-only',
      prompt: 'produce changelog',
      executeTurn: async (input) => {
        turns.push(input)
        const content = input.attempt === 1
          ? 'initial draft'
          : 'v1.0.0 released'
        await putMcpArtifact(input.mcpServerUrl, input.mcpAuthToken, 'CHANGELOG.md', content)
        return { output: 'done', sessionId: input.sessionId }
      },
    }

    const result = await runHarness({
      name: 'custom-validate-retry-harness',
      steps: [
        {
          id: 's1',
          run: agent,
          artifacts: {
            'CHANGELOG.md': {
              validate: async (c: string) => c.includes('v1.0.0'),
            },
          },
        },
      ],
    }, { workspaceDir: tempDir })

    expect(result.status).toBe('passed')
    expect(turns).toHaveLength(2)
    expect(turns[1].prompt).toContain('Artifact "CHANGELOG.md" failed custom validation.')
  })
})
