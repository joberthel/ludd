import fs from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readRunState, resolveRunDir } from '../../persistence/state-store.js'
import { runHarness } from '../run-harness.js'

let workspaceDir: string

afterEach(async () => {
  if (workspaceDir)
    await rm(workspaceDir, { recursive: true, force: true })
})

describe('runHarness workflow identity persistence', () => {
  it('persists the workflow name and normalized config path', async () => {
    workspaceDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-workflow-identity-'))
    const config = {
      name: 'workflow-identity',
      steps: [
        {
          id: 'done',
          run: async () => 'ok',
        },
      ],
    }

    const result = await runHarness(config, {
      runId: 'identity-run',
      workspaceDir,
      configPath: path.join(workspaceDir, 'workflows', '..', 'workflows', 'custom.config.ts'),
    })

    expect(result.status).toBe('passed')
    const snapshot = readRunState(resolveRunDir(workspaceDir, 'identity-run'))
    expect(snapshot.workflowName).toBe('workflow-identity')
    expect(snapshot.configPath).toBe(path.join('workflows', 'custom.config.ts'))
    expect(fs.existsSync(path.join(resolveRunDir(workspaceDir, 'identity-run'), 'state.json'))).toBe(true)
  })
})
