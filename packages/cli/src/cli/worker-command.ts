import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { resumeCommand } from '../commands/resume-command.js'
import { runCommand } from '../commands/run-command.js'
import { parse, text } from './parse-args.js'

export async function workerCommand(args: string[]): Promise<void> {
  const { values, positionals } = parse(args, {
    'config': { type: 'string' },
    'run-id': { type: 'string' },
    'workspace': { type: 'string' },
  })
  const configPath = text(values, 'config')
  const runId = text(values, 'run-id')
  const rawWorkspace = text(values, 'workspace')
  if (positionals.length > 0 || configPath === undefined || runId === undefined || rawWorkspace === undefined)
    throw new Error('Invalid internal worker arguments.')
  const workspace = path.resolve(rawWorkspace)
  const stateFile = path.join(workspace, '.harness', 'runs', runId, 'state.json')
  process.exitCode = fs.existsSync(stateFile)
    ? await resumeCommand({ runId, workspace, worker: true })
    : await runCommand({
        runId,
        workspace,
        configPath,
        worker: true,
      })
}
