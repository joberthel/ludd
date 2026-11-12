import process from 'node:process'
import { gcCommand } from '../commands/gc-command.js'
import { flag, parse, text } from './parse-args.js'

export async function cliGcCommand(args: string[]): Promise<void> {
  const { values, positionals } = parse(args, {
    'workspace': { type: 'string', short: 'w' },
    'run-id': { type: 'string', multiple: true },
    'older-than': { type: 'string' },
    'status': { type: 'string', multiple: true },
    'dry-run': { type: 'boolean' },
  })
  const runIds = [
    ...positionals,
    ...(Array.isArray(values['run-id'])
      ? values['run-id']
      : []),
  ]
  process.exitCode = await gcCommand({
    ...(runIds.length
      ? { runId: runIds }
      : {}),
    ...(text(values, 'workspace') !== undefined
      ? {
          workspace: text(values, 'workspace'),
        }
      : {}),
    ...(text(values, 'older-than') !== undefined
      ? {
          olderThan: text(values, 'older-than'),
        }
      : {}),
    ...(Array.isArray(values.status)
      ? { status: values.status }
      : {}),
    ...(flag(values, 'dry-run')
      ? { dryRun: true }
      : {}),
  })
}
