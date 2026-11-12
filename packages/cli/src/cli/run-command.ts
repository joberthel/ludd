import process from 'node:process'
import { runCommand } from '../commands/run-command.js'
import { flag, parse, text } from './parse-args.js'

export async function cliRunCommand(args: string[]): Promise<void> {
  const { values, positionals } = parse(args, {
    'config': { type: 'string', short: 'c' },
    'run-id': { type: 'string', short: 'r' },
    'workspace': { type: 'string', short: 'w' },
    'stream': { type: 'boolean', short: 's' },
    'detach': { type: 'boolean', short: 'd' },
  })
  const config = text(values, 'config')
  if (positionals.length > 1 || (config !== undefined && positionals.length))
    throw new Error('Usage: ludd run [configPath] [-c|--config path] [-r|--run-id id] [-w|--workspace dir] [-s|--stream] [-d|--detach]')
  process.exitCode = await runCommand({
    ...((config ?? positionals[0]) !== undefined
      ? { configPath: config ?? positionals[0] }
      : {}),
    ...(text(values, 'run-id') !== undefined
      ? {
          runId: text(values, 'run-id'),
        }
      : {}),
    ...(text(values, 'workspace') !== undefined
      ? {
          workspace: text(values, 'workspace'),
        }
      : {}),
    ...(flag(values, 'stream')
      ? { stream: true }
      : {}),
    ...(flag(values, 'detach')
      ? { detach: true }
      : {}),
  })
}
