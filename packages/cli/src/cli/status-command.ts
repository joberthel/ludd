import process from 'node:process'
import { statusCommand } from '../commands/status-command.js'
import { flag, parse, text } from './parse-args.js'

export async function cliStatusCommand(args: string[]): Promise<void> {
  const { values, positionals } = parse(args, {
    workspace: { type: 'string', short: 'w' },
    json: { type: 'boolean' },
  })
  if (positionals.length > 1)
    throw new Error('Usage: ludd status [runId] [--json] [-w|--workspace dir]')
  process.exitCode = await statusCommand({
    ...(positionals[0] !== undefined
      ? { runId: positionals[0] }
      : {}),
    ...(text(values, 'workspace') !== undefined
      ? {
          workspace: text(values, 'workspace'),
        }
      : {}),
    ...(flag(values, 'json')
      ? { json: true }
      : {}),
  })
}
