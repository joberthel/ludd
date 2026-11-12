import process from 'node:process'
import { abortCommand } from '../commands/abort-command.js'
import { teardownCommand } from '../commands/teardown-command.js'
import { flag, parse, text } from './parse-args.js'

export async function cliAbortCommand(args: string[]): Promise<void> {
  const { values, positionals } = parse(args, {
    workspace: { type: 'string', short: 'w' },
    reason: { type: 'string' },
    teardown: { type: 'boolean' },
  })
  if (positionals.length !== 1)
    throw new Error('Usage: ludd abort <runId> [--reason text] [--teardown] [-w|--workspace dir]')
  process.exitCode = await abortCommand({
    runId: positionals[0],
    ...(text(values, 'workspace') !== undefined
      ? {
          workspace: text(values, 'workspace'),
        }
      : {}),
    ...(text(values, 'reason') !== undefined
      ? {
          reason: text(values, 'reason'),
        }
      : {}),
    ...(flag(values, 'teardown')
      ? { teardown: true }
      : {}),
  })
}

export async function cliTeardownCommand(args: string[]): Promise<void> {
  const { values, positionals } = parse(args, {
    workspace: { type: 'string', short: 'w' },
    force: { type: 'boolean' },
  })
  if (positionals.length !== 1)
    throw new Error('Usage: ludd teardown <runId> [--force] [-w|--workspace dir]')
  process.exitCode = await teardownCommand({
    runId: positionals[0],
    ...(text(values, 'workspace') !== undefined
      ? {
          workspace: text(values, 'workspace'),
        }
      : {}),
    ...(flag(values, 'force')
      ? { force: true }
      : {}),
  })
}
