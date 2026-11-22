import type { RunAlreadyExistsError } from '@ludd/core'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runCommand } from './run-command.js'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true })
})

describe('runCommand', () => {
  it('fails fast when the explicit run id already has a state file', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'ludd-cli-'))
    directories.push(workspace)
    const runDir = path.join(workspace, '.harness', 'runs', 'run-1')
    fs.mkdirSync(runDir, { recursive: true })
    fs.writeFileSync(path.join(runDir, 'state.json'), '{}')
    await expect(runCommand({ runId: 'run-1', workspace })).rejects.toMatchObject({
      name: 'RunAlreadyExistsError',
      message: 'Run "run-1" already exists. Use "ludd resume run-1" to resume it.',
    } satisfies Partial<RunAlreadyExistsError>)
  })
})
